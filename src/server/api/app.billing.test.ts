import BetterSqlite3 from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { GRACE_DAYS } from "@/server/billing/plan-state";
import { PLANS } from "@/server/billing/pricing";
import { D1BillingRepository } from "@/server/billing/store";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";

/**
 * EVENT-INGESTION + FREEZE-GATE end-to-end über `app.request()` (echte 0009-DDL
 * via sqlite-Shim, Memory-Auth). Verhinderte Fehlerfälle:
 *  - Beacon zählt ohne Cookie-Identität (kein Dedup möglich) oder oracelt
 *    Artikel-Existenz/Infrastruktur aus.
 *  - Team-Sessions verbrennen Credits des eigenen Tenants.
 *  - Freeze sperrt LESEN (falsch) oder lässt MUTATIONEN durch (falsch);
 *    Team-/Legal-Routen geraten fälschlich unters Gate.
 */

const NOW_SEC = Math.floor(Date.now() / 1000);
const HOST_DEMO = "demo.hallofhelp.com";
const HOST_ACME = "acme.hallofhelp.com";

const TENANTS: Record<string, Tenant> = {
  [HOST_DEMO]: {
    id: "t_demo",
    slug: "demo",
    name: "Demo",
    customDomain: null,
    defaultLocale: "de",
    branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
  },
  [HOST_ACME]: {
    id: "t_acme",
    slug: "acme",
    name: "Acme",
    customDomain: null,
    defaultLocale: "en",
    branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
  },
};

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";
const PASSWORD = "correct-horse-battery";

type Row = Record<string, unknown>;

function makeFixture() {
  const sqlite = new BetterSqlite3(":memory:");
  applyMigrations(sqlite, ["0001_tenants.sql", "0021_tenant_suspend.sql", "0023_logo_dark.sql", "0005_content.sql", "0018_article_images.sql", "0019_article_translations.sql", "0009_usage_billing.sql", "0011_usage_feedback_types.sql", "0016_usage_ai_source_type.sql", "0020_usage_ai_translation_type.sql", "0022_plan_custom_limits.sql"]);
  sqlite
    .prepare(
      `INSERT INTO articles (id, tenant_id, slug, title, category, status)
       VALUES ('a1', 't_demo', 'erste-schritte', 'Erste Schritte', 'Start', 'published')`,
    )
    .run();

  const authDb: Record<string, Row[]> = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const deps: ApiDeps = {
    resolveTenant: async (host) => TENANTS[(host ?? "").split(":")[0].toLowerCase()] ?? null,
    createAuthForTenant: async () =>
      buildAuth({
        adapter: memoryAdapter(authDb)(tenantAuthOptions(TEST_SECRET)),
        secret: TEST_SECRET,
      }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
    getBillingDeps: async () => ({ repo: new D1BillingRepository(d1FromSqlite(sqlite)) }),
  };
  return { app: buildApiApp(deps), sqlite, authDb };
}

type Fixture = ReturnType<typeof makeFixture>;

function postView(f: Fixture, body: unknown, cookie?: string) {
  return f.app.request("/api/v1/events/view", {
    method: "POST",
    headers: {
      host: HOST_DEMO,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function countEvents(f: Fixture): number {
  return (
    f.sqlite.prepare(`SELECT COUNT(*) AS c FROM usage_events WHERE tenant_id = 't_demo'`).get() as {
      c: number;
    }
  ).c;
}

/** Session via echtem Sign-up/Sign-in; Rolle optional direkt am Memory-Row. */
async function session(f: Fixture, email: string, role?: string): Promise<string> {
  const post = (path: string, body: unknown) =>
    f.app.request(path, {
      method: "POST",
      headers: { host: HOST_DEMO, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await post(`${AUTH_BASE_PATH}/sign-up/email`, { email, password: PASSWORD, name: "U" })).status).toBe(200);
  const user = f.authDb.auth_user.find((u) => u.email === email)!;
  user.email_verified = true;
  if (role) user.role = role;
  const signIn = await post(`${AUTH_BASE_PATH}/sign-in/email`, { email, password: PASSWORD });
  expect(signIn.status).toBe(200);
  return signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

describe("POST /api/v1/events/view (public Beacon)", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it("anonym: 204 + pseudonymes Besucher-Cookie + Event verbucht; Replay dedupliziert", async () => {
    const first = await postView(f, { slug: "erste-schritte" });
    expect(first.status).toBe(204);
    const setCookie = first.headers.getSetCookie().find((c) => c.startsWith("hoh_vid="));
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("HttpOnly");
    expect(countEvents(f)).toBe(1);

    // Gleicher Besucher (Cookie zurückgespielt) im Dedup-Fenster → kein 2. Event.
    const vid = setCookie!.split(";")[0];
    const second = await postView(f, { slug: "erste-schritte" }, vid);
    expect(second.status).toBe(204);
    expect(countEvents(f)).toBe(1);
  });

  it("unbekannter/Draft-Slug und kaputter Body: 204 OHNE Event (kein Orakel)", async () => {
    expect((await postView(f, { slug: "gibts-nicht" })).status).toBe(204);
    expect(
      (
        await f.app.request("/api/v1/events/view", {
          method: "POST",
          headers: { host: HOST_DEMO },
          body: "kein json",
        })
      ).status,
    ).toBe(204);
    expect(countEvents(f)).toBe(0);
  });

  it("Team-Session (admin): Event als internal, 0 Credits, kein MAU", async () => {
    const cookie = await session(f, "admin@example.com", "admin");
    expect((await postView(f, { slug: "erste-schritte" }, cookie)).status).toBe(204);

    const event = f.sqlite
      .prepare(`SELECT actor_type, credits FROM usage_events WHERE tenant_id = 't_demo'`)
      .get() as Row;
    expect(event).toEqual({ actor_type: "internal", credits: 0 });
    const usage = f.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM usage_mau WHERE tenant_id = 't_demo'`)
      .get() as { c: number };
    expect(usage.c).toBe(0);
  });
});

describe("Freeze-Gate auf Admin-Mutationen (Infra-Plan Schritt 4)", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  function freezeDemoTenant() {
    // Free-Limit überschritten + Grace abgelaufen → abgeleiteter Status frozen.
    f.sqlite
      .prepare(
        `INSERT INTO tenant_usage (tenant_id, period, credits_used, updated_at)
         VALUES ('t_demo', strftime('%Y-%m','now'), ?, ?)`,
      )
      .run(PLANS.free.includedCredits + 1, NOW_SEC);
    f.sqlite
      .prepare(
        `INSERT INTO tenant_plan (tenant_id, plan, over_limit_since, updated_at)
         VALUES ('t_demo', 'free', ?, ?)`,
      )
      .run(NOW_SEC - (GRACE_DAYS + 1) * 86_400, NOW_SEC);
  }

  it("frozen: Artikel-CREATE → 402 plan_frozen; LESEN bleibt frei (kein 402)", async () => {
    freezeDemoTenant();
    const cookie = await session(f, "user@example.com");

    const mutation = await f.app.request("/api/v1/admin/articles", {
      method: "POST",
      headers: { host: HOST_DEMO, "content-type": "application/json", cookie },
      body: JSON.stringify({ title: "Neu" }),
    });
    expect(mutation.status).toBe(402);
    expect(await mutation.json()).toEqual({ error: "plan_frozen" });

    // GET läuft am Gate vorbei: es gibt bewusst KEINE GET-HTTP-Route unter
    // /admin/articles (Admin liest über Server-Funktionen) → mit Session 404
    // aus dem normalen Routing — entscheidend ist: KEIN 402.
    const read = await f.app.request("/api/v1/admin/articles", {
      headers: { host: HOST_DEMO, cookie },
    });
    expect(read.status).toBe(404);
  });

  it("frozen: Team-/Legal-Pflege bleibt BEWUSST bedienbar (kein 402)", async () => {
    freezeDemoTenant();
    const cookie = await session(f, "user2@example.com");
    const res = await f.app.request("/api/v1/admin/legal/impressum", {
      method: "PUT",
      headers: { host: HOST_DEMO, "content-type": "application/json", cookie },
      body: JSON.stringify({ mode: "link", url: "https://example.com/impressum" }),
    });
    // Guard-Kette statt Freeze: 403 (role=user) — nicht 402.
    expect(res.status).toBe(403);
  });

  it("aktiver Tenant: Mutation passiert das Gate (Guard-Kette antwortet, kein 402)", async () => {
    const cookie = await session(f, "user3@example.com");
    const res = await f.app.request("/api/v1/admin/articles", {
      method: "POST",
      headers: { host: HOST_DEMO, "content-type": "application/json", cookie },
      body: JSON.stringify({ title: "Neu" }),
    });
    expect(res.status).toBe(403);
  });
});
