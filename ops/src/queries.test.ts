import BetterSqlite3 from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, d1FromSqlite } from "@product/server/auth/sqlite-test-support";
import { listTenants, platformStats, tenantDetail } from "./queries";

/**
 * OPS-QUERIES gegen die ECHTE Migrations-DDL. Verhinderte Fehlerfälle:
 *  - Owner-Subquery greift falsche Rolle/fremden Tenant (falsche Anzeige des
 *    kritischsten Felds im Dashboard).
 *  - Status kommt nicht aus der geteilten Plan-Logik (Drift zu Produkt/Admin).
 *  - Plattform-Aggregate mischen Tenants oder zählen Perioden falsch.
 */

const NOW = 1_800_000_000; // 2027-01-15 UTC

function setup() {
  const sqlite = new BetterSqlite3(":memory:");
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
    "0012_enterprise_plan.sql", "0022_plan_custom_limits.sql",
    "0013_seo_indexable.sql", "0021_tenant_suspend.sql", "0023_logo_dark.sql",
    "0014_support_email.sql",
    "0015_support_tickets.sql",
  ]);
  // Migration 0001 seedet demo/acme — für deterministische Tests leeren.
  sqlite.prepare(`DELETE FROM tenants`).run();

  sqlite
    .prepare(`INSERT INTO tenants (id, slug, name, created_at) VALUES ('t_a','alpha','Alpha', ?)`)
    .run(NOW - 86400);
  sqlite
    .prepare(`INSERT INTO tenants (id, slug, name, created_at) VALUES ('t_b','beta','Beta', ?)`)
    .run(NOW - 2 * 86400);

  const user = sqlite.prepare(
    `INSERT INTO auth_user (id, tenant_id, name, email, email_verified, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
  );
  user.run("u1", "t_a", "Owner A", "owner@alpha.de", "owner", NOW, NOW);
  user.run("u2", "t_a", "Content A", "content@alpha.de", "content", NOW, NOW);
  user.run("u3", "t_b", "Owner B", "owner@beta.de", "owner", NOW, NOW);

  // Anmeldemethoden: u1 hat Passwort+Google, u2 nichts (Ops-erstellt).
  sqlite
    .prepare(
      `INSERT INTO auth_account (id, tenant_id, user_id, account_id, provider_id, password)
       VALUES ('a1','t_a','u1','u1','credential','hash'),
              ('a2','t_a','u1','g-1','google',NULL)`,
    )
    .run();

  const ev = sqlite.prepare(
    `INSERT INTO usage_events (id, tenant_id, type, credits, actor_type, visitor_id, user_id, article_id, created_at)
     VALUES (?, ?, ?, ?, 'anon', ?, NULL, NULL, ?)`,
  );
  ev.run("e1", "t_a", "article_view", 1, "v1", NOW - 60);
  ev.run("e2", "t_a", "ai_generation", 20, "v1", NOW - 60);
  ev.run("e3", "t_b", "article_view", 1, "v2", NOW - 60);

  sqlite
    .prepare(
      `INSERT INTO tenant_usage (tenant_id, period, credits_used, updated_at)
       VALUES ('t_a', '2027-01', 21, ?), ('t_b', '2027-01', 1, ?)`,
    )
    .run(NOW, NOW);
  sqlite
    .prepare(
      `INSERT INTO usage_mau (tenant_id, period, visitor_id, first_seen_at)
       VALUES ('t_a','2027-01','v1',?), ('t_b','2027-01','v2',?)`,
    )
    .run(NOW, NOW);

  return { db: d1FromSqlite(sqlite), sqlite };
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

describe("listTenants", () => {
  it("liefert Owner je Instanz (nie fremde) + Status aus der geteilten Plan-Logik", async () => {
    const rows = await listTenants(ctx.db, NOW);
    expect(rows.map((r) => r.slug)).toEqual(["alpha", "beta"]); // neueste zuerst
    const alpha = rows[0];
    expect(alpha.ownerEmail).toBe("owner@alpha.de");
    expect(alpha.creditsUsed).toBe(21);
    expect(alpha.mau).toBe(1);
    expect(alpha.state.status).toBe("active");
    expect(alpha.state.plan.id).toBe("free");
    expect(rows[1].ownerEmail).toBe("owner@beta.de");
  });

  it("Instanz ohne Owner-Konto zeigt ownerEmail null (Warnfall im UI)", async () => {
    ctx.sqlite.prepare(`DELETE FROM auth_user WHERE id = 'u3'`).run();
    const rows = await listTenants(ctx.db, NOW);
    expect(rows.find((r) => r.slug === "beta")?.ownerEmail).toBeNull();
  });
});

describe("platformStats", () => {
  it("aggregiert über ALLE Instanzen (Periode + 30-Tage-Fenster)", async () => {
    const stats = await platformStats(ctx.db, NOW);
    expect(stats.tenants).toBe(2);
    expect(stats.creditsUsedPeriod).toBe(22);
    expect(stats.mauPeriod).toBe(2);
    expect(stats.views30).toBe(2);
    expect(stats.generations30).toBe(1);
    expect(stats.series.views.length).toBe(30);
    expect(stats.series.views[29]).toBe(2); // heute: beide Views
  });
});

describe("tenantDetail", () => {
  it("liefert Nutzerliste (owner zuerst) + Meta; unbekannte Id → null", async () => {
    const detail = await tenantDetail(ctx.db, "t_a", NOW);
    expect(detail).not.toBeNull();
    expect(detail!.users.map((u) => u.role)).toEqual(["owner", "content"]);
    // Anmeldemethoden aus auth_account (nie fremde Nutzer/Tenants):
    expect(detail!.users[0].providers).toEqual(["credential", "google"]);
    expect(detail!.users[1].providers).toEqual([]);
    expect(detail!.row.ownerEmail).toBe("owner@alpha.de");
    expect(detail!.defaultLocale).toBe("de");
    expect(detail!.viewSeries.length).toBe(30);
    // 30-Tage-Zähler (Prefill Selbstkostenrechner): nur t_a-Events, nie fremde.
    expect(detail!.usage30).toEqual({ views: 1, generations: 1, translations: 0 });

    expect(await tenantDetail(ctx.db, "t_gibtsnicht", NOW)).toBeNull();
  });
});
