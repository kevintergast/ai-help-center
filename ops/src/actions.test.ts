import BetterSqlite3 from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, d1FromSqlite } from "@product/server/auth/sqlite-test-support";
import { readPlanState } from "@product/server/billing/store";
import { D1BillingRepository } from "@product/server/billing/store";
import type { OpsEnv } from "./access";
import { deleteTenant, parsePlanForm, setPlan, suspendTenant, unsuspendTenant } from "./actions";

/**
 * OPS-VERWALTUNGSAKTIONEN. Verhinderte Fehlerfälle:
 *  - t_operator lässt sich sperren/löschen (Plattform-Selbstzerstörung).
 *  - Löschen ohne vorherige Sperre (Zwei-Schritt-Schutz umgangen) oder mit
 *    Waisen in D1/Vectorize/R2.
 *  - Enterprise-Rahmen wirkt nicht in der GETEILTEN Plan-Logik (Deckel wäre
 *    reine Anzeige) oder überlebt einen Plan-Wechsel zurück auf Self-Service.
 */

const NOW = 1_800_000_000;

function setup() {
  const sqlite = new BetterSqlite3(":memory:");
  sqlite.pragma("foreign_keys = ON"); // D1 erzwingt FKs — der Test auch.
  applyMigrations(sqlite, [
    "0001_tenants.sql",
    "0002_auth.sql",
    "0005_content.sql",
    "0018_article_images.sql",
    "0019_article_translations.sql",
    "0009_usage_billing.sql",
    "0011_usage_feedback_types.sql",
    "0016_usage_ai_source_type.sql",
    "0020_usage_ai_translation_type.sql",
    "0012_enterprise_plan.sql",
    "0022_plan_custom_limits.sql",
    "0013_seo_indexable.sql",
    "0021_tenant_suspend.sql",
    "0010_search_chunks.sql",
  ]);
  sqlite.prepare(`DELETE FROM tenants`).run();
  sqlite.prepare(`INSERT INTO tenants (id, slug, name) VALUES ('t_operator','app','Ops')`).run();
  sqlite.prepare(`INSERT INTO tenants (id, slug, name) VALUES ('t_x','xfirma','X Firma')`).run();
  sqlite
    .prepare(
      `INSERT INTO auth_user (id, tenant_id, name, email, email_verified, role, created_at, updated_at)
       VALUES ('ux','t_x','O','o@x.de',1,'owner',?,?)`,
    )
    .run(NOW, NOW);
  sqlite
    .prepare(
      `INSERT INTO articles (id, tenant_id, slug, title, category, status) VALUES ('ax','t_x','a','A','K','published')`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO search_chunks (tenant_id, article_id, chunk_index, content_hash, vector_id, updated_at)
       VALUES ('t_x','ax',0,'h1','vec-1',?), ('t_x','ax',1,'h2','vec-2',?)`,
    )
    .run(NOW, NOW);

  const db = d1FromSqlite(sqlite);
  return { sqlite, db };
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

describe("suspend/unsuspend", () => {
  it("sperrt und entsperrt; t_operator ist hart geschützt", async () => {
    expect(await suspendTenant(ctx.db, "t_x", NOW)).toBe("ok");
    const row = ctx.sqlite.prepare(`SELECT suspended_at FROM tenants WHERE id='t_x'`).get() as {
      suspended_at: number;
    };
    expect(row.suspended_at).toBe(NOW);

    expect(await unsuspendTenant(ctx.db, "t_x")).toBe("ok");
    expect(await suspendTenant(ctx.db, "t_operator", NOW)).toBe("protected");
  });
});

describe("setPlan + Enterprise-Rahmen (wirkt in der geteilten Plan-Logik)", () => {
  it("enterprise mit Deckel: over_limit erst über dem INDIVIDUELLEN Wert", async () => {
    expect(
      await setPlan(ctx.db, {
        tenantId: "t_x",
        plan: "enterprise",
        customIncludedCredits: 500,
        customMauLimit: 50,
      }),
    ).toBe("ok");

    // Verbrauch über dem Custom-Deckel, aber weit unter dem Enterprise-Standard.
    ctx.sqlite
      .prepare(
        `INSERT INTO tenant_usage (tenant_id, period, credits_used, updated_at)
         VALUES ('t_x','2027-01',600,?)`,
      )
      .run(NOW);
    // MAU über custom_mau_limit (50): 51 Besucher.
    const mau = ctx.sqlite.prepare(
      `INSERT INTO usage_mau (tenant_id, period, visitor_id, first_seen_at) VALUES ('t_x','2027-01',?,?)`,
    );
    for (let i = 0; i < 51; i++) mau.run(`v${i}`, NOW);

    const state = await readPlanState(new D1BillingRepository(ctx.db), "t_x", NOW);
    expect(state.plan.id).toBe("enterprise");
    expect(state.plan.includedCredits).toBe(500); // EFFEKTIVER Rahmen
    expect(state.plan.mauLimit).toBe(50);
    expect(state.isOver).toBe(true); // MAU 51 > 50 → Verstoß trotz Enterprise
  });

  it("Wechsel zurück auf starter NULLT die Overrides", async () => {
    await setPlan(ctx.db, {
      tenantId: "t_x",
      plan: "enterprise",
      customIncludedCredits: 500,
      customMauLimit: 50,
    });
    await setPlan(ctx.db, {
      tenantId: "t_x",
      plan: "starter",
      customIncludedCredits: null,
      customMauLimit: null,
    });
    const state = await readPlanState(new D1BillingRepository(ctx.db), "t_x", NOW);
    expect(state.plan.id).toBe("starter");
    expect(state.plan.includedCredits).toBe(25_000); // Plan-Standard zurück
  });

  it("parsePlanForm: enterprise übernimmt Zahlen, andere Pläne nullen; Müll → null", () => {
    expect(
      parsePlanForm({ plan: "enterprise", customIncludedCredits: "500", customMauLimit: "" }),
    ).toMatchObject({ plan: "enterprise", customIncludedCredits: 500, customMauLimit: null });
    expect(
      parsePlanForm({ plan: "scale", customIncludedCredits: "500", customMauLimit: "50" }),
    ).toMatchObject({ plan: "scale", customIncludedCredits: null, customMauLimit: null });
    expect(parsePlanForm({ plan: "gibtsnicht" })).toBeNull();
    expect(parsePlanForm({ plan: "enterprise", customIncludedCredits: "-5" })).toBeNull();
  });
});

describe("deleteTenant — Zwei-Schritt + Cleanup", () => {
  function opsEnv(): { env: OpsEnv; deletedVectorIds: string[]; deletedKeys: string[] } {
    const deletedVectorIds: string[] = [];
    const deletedKeys: string[] = [];
    const env = {
      DB: ctx.db,
      VECTORIZE: {
        deleteByIds: async (ids: string[]) => {
          deletedVectorIds.push(...ids);
        },
      } as unknown as VectorizeIndex,
      MEDIA: {
        list: async () => ({
          objects: [{ key: "tenants/t_x/logo" }, { key: "tenants/t_x/articles/ax/img1" }],
          truncated: false,
        }),
        delete: async (key: string) => {
          deletedKeys.push(key);
        },
      } as unknown as R2Bucket,
    } as OpsEnv;
    return { env, deletedVectorIds, deletedKeys };
  }

  it("nicht blockiert → invalid (Zwei-Schritt); t_operator → protected", async () => {
    const { env } = opsEnv();
    expect(await deleteTenant(env, "t_x")).toBe("invalid");
    expect(await deleteTenant(env, "t_operator")).toBe("protected");
    expect(ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM tenants`).get()).toEqual({ n: 2 });
  });

  it("blockiert → löscht D1 (CASCADE), Vektoren und R2-Prefix", async () => {
    await suspendTenant(ctx.db, "t_x", NOW);
    const { env, deletedVectorIds, deletedKeys } = opsEnv();

    expect(await deleteTenant(env, "t_x")).toBe("ok");

    expect(deletedVectorIds.sort()).toEqual(["vec-1", "vec-2"]);
    expect(deletedKeys).toEqual(["tenants/t_x/logo", "tenants/t_x/articles/ax/img1"]);
    // CASCADE: alles Relationale weg, andere Tenants unberührt.
    expect(ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM tenants`).get()).toEqual({ n: 1 });
    expect(ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM auth_user`).get()).toEqual({ n: 0 });
    expect(ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM articles`).get()).toEqual({ n: 0 });
    expect(ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM search_chunks`).get()).toEqual({ n: 0 });
  });
});
