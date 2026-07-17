import BetterSqlite3 from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { D1BillingRepository } from "@/server/billing/store";
import { makeVisitorIdCodec } from "@/server/security/visitor-id";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";
import type { RateLimiterBinding } from "./rate-limit";

/**
 * ABUSE-HÄRTUNG end-to-end (Verhalten, nicht Implementierung). Verhinderte
 * Fehlerfälle:
 *  - Limiter greift NICHT auf den teuren/mail-sendenden Pfaden (429 fehlt) →
 *    automatisierte Flutung von /ask, Beacons und Auth-Mails bliebe möglich.
 *  - Limiter gerät fälschlich vor GETTER/harmlose Auth-Pfade (Login bräche).
 *  - Gefälschte Besucher-Cookies werden als Identität akzeptiert →
 *    Dedup-Umgehung (Credits-Sabotage) + MAU-Inflation.
 */

const HOST = "demo.hallofhelp.com";
const TENANTS: Record<string, Tenant> = {
  [HOST]: {
    id: "t_demo",
    slug: "demo",
    name: "Demo",
    customDomain: null,
    defaultLocale: "de",
    branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
  },
};
const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";

const denyAll: RateLimiterBinding = { limit: async () => ({ success: false }) };

function makeFixture(opts: { deny?: ("ask" | "events" | "sensitive")[] } = {}) {
  const sqlite = new BetterSqlite3(":memory:");
  applyMigrations(sqlite, ["0001_tenants.sql", "0021_tenant_suspend.sql", "0005_content.sql", "0018_article_images.sql", "0019_article_translations.sql", "0009_usage_billing.sql", "0011_usage_feedback_types.sql", "0016_usage_ai_source_type.sql", "0020_usage_ai_translation_type.sql", "0022_plan_custom_limits.sql"]);
  sqlite
    .prepare(
      `INSERT INTO articles (id, tenant_id, slug, title, category, status)
       VALUES ('a1', 't_demo', 'erste-schritte', 'Erste Schritte', 'Start', 'published')`,
    )
    .run();

  const authDb: Record<string, Record<string, unknown>[]> = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const deny = new Set(opts.deny ?? []);
  const codec = makeVisitorIdCodec(TEST_SECRET);
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
    getAskDeps: async () => ({
      answer: async () => ({
        status: "ok",
        answer: { question: "q", body: ["a"], citations: [], grounded: true, sourceRefs: [] },
      }),
    }),
    rateLimiters: {
      ask: deny.has("ask") ? denyAll : undefined,
      events: deny.has("events") ? denyAll : undefined,
      sensitive: deny.has("sensitive") ? denyAll : undefined,
    },
    visitorCodec: codec,
  };
  return { app: buildApiApp(deps), sqlite, codec };
}

const post = (f: ReturnType<typeof makeFixture>, path: string, body: unknown, cookie?: string) =>
  f.app.request(path, {
    method: "POST",
    headers: {
      host: HOST,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

describe("IP-Rate-Limits (429 auf den richtigen Pfaden, fail-open sonst)", () => {
  it("/ask → 429 wenn der ask-Limiter ablehnt; ohne Limiter läuft er durch", async () => {
    const limited = makeFixture({ deny: ["ask"] });
    const res = await post(limited, "/api/v1/ask", { question: "Wie geht das?" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });

    const open = makeFixture();
    expect((await post(open, "/api/v1/ask", { question: "Wie geht das?" })).status).toBe(200);
  });

  it("/events/view + /events/feedback → 429 unter events-Limit; nichts wird verbucht", async () => {
    const f = makeFixture({ deny: ["events"] });
    expect((await post(f, "/api/v1/events/view", { slug: "erste-schritte" })).status).toBe(429);
    expect((await post(f, "/api/v1/events/feedback", { slug: "erste-schritte", helpful: true })).status).toBe(429);
    const events = f.sqlite.prepare(`SELECT COUNT(*) AS c FROM usage_events`).get() as {
      c: number;
    };
    expect(events.c).toBe(0);
  });

  it("mail-sendende Auth-Pfade → 429; get-session bleibt UNGEBREMST", async () => {
    const f = makeFixture({ deny: ["sensitive"] });
    const signup = await post(f, "/api/v1/auth/sign-up/email", {
      email: "a@example.com",
      password: "x".repeat(12),
      name: "A",
    });
    expect(signup.status).toBe(429);

    const reset = await post(f, "/api/v1/auth/request-password-reset", {
      email: "a@example.com",
    });
    expect(reset.status).toBe(429);

    // Sessions lesen ist kein Mail-Pfad — das sensitive-Limit darf hier NIE greifen.
    const session = await f.app.request("/api/v1/auth/get-session", {
      headers: { host: HOST },
    });
    expect(session.status).toBe(200);
  });
});

describe("Signierte Besucher-IDs am Beacon", () => {
  it("gefälschtes Cookie wird verworfen → neue signierte ID; echtes Cookie bleibt", async () => {
    const f = makeFixture();

    // Gefälschte/erfundene ID: Server stellt eine NEUE signierte ID aus.
    const forged = await post(f, "/api/v1/events/view", { slug: "erste-schritte" }, "hoh_vid=erfunden-123");
    expect(forged.status).toBe(204);
    const issued = forged.headers.get("set-cookie");
    expect(issued).toContain("hoh_vid=");
    const value = /hoh_vid=([^;]+)/.exec(issued ?? "")?.[1] ?? "";
    expect(await f.codec.verify("t_demo", decodeURIComponent(value))).not.toBeNull();

    // Gültige (signierte) ID wird akzeptiert — kein neues Cookie nötig.
    const valid = await post(
      f,
      "/api/v1/events/view",
      { slug: "erste-schritte" },
      `hoh_vid=${value}`,
    );
    expect(valid.status).toBe(204);
    expect(valid.headers.get("set-cookie")).toBeNull();

    // Request 2 lief unter DERSELBEN (der frisch vergebenen) ID wie Request 1
    // → View-Dedup greift: genau EIN Event. Die erfundene ID selbst hat NIE
    // eine eigene Identität erzeugt — Rotation bringt dem Angreifer nichts.
    const events = f.sqlite.prepare(`SELECT COUNT(*) AS c FROM usage_events`).get() as {
      c: number;
    };
    expect(events.c).toBe(1);
  });

  it("Feedback-Beacon verbucht mit signierter ID (0 Credits) und antwortet 204", async () => {
    const f = makeFixture();
    const res = await post(f, "/api/v1/events/feedback", { slug: "erste-schritte", helpful: false });
    expect(res.status).toBe(204);
    const row = f.sqlite
      .prepare(`SELECT type, credits FROM usage_events WHERE tenant_id = 't_demo'`)
      .get();
    expect(row).toEqual({ type: "feedback_unhelpful", credits: 0 });
  });
});

describe("Widget-Transport (x-hoh-vid-Header + /widget/session)", () => {
  const withHeader = (
    f: ReturnType<typeof makeFixture>,
    path: string,
    body: unknown,
    vid: string,
  ) =>
    f.app.request(path, {
      method: "POST",
      headers: {
        host: HOST,
        "content-type": "application/json",
        "x-hoh-vid": vid,
      },
      body: JSON.stringify(body),
    });

  it("/widget/session stellt eine verifizierbare ID aus und REUSED eine gültige", async () => {
    const f = makeFixture();
    const first = await f.app.request("/api/v1/widget/session", { headers: { host: HOST } });
    expect(first.status).toBe(200);
    const { visitorId } = (await first.json()) as { visitorId: string };
    expect(await f.codec.verify("t_demo", visitorId)).toBe(visitorId);
    expect(first.headers.get("set-cookie")).toContain("hoh_vid=");

    // Zweiter Bootstrap MIT gültigem Header: dieselbe Identität zurück
    // (kein MAU-Inflations-Reset bei jedem Widget-Load).
    const second = await f.app.request("/api/v1/widget/session", {
      headers: { host: HOST, "x-hoh-vid": visitorId },
    });
    expect(((await second.json()) as { visitorId: string }).visitorId).toBe(visitorId);
  });

  it("gültiger Header identifiziert (Dedup greift, kein neues Cookie); gefälschter nicht", async () => {
    const f = makeFixture();
    const { visitorId } = (await (
      await f.app.request("/api/v1/widget/session", { headers: { host: HOST } })
    ).json()) as { visitorId: string };

    // Zwei Views mit demselben Header = EIN Event (Dedup über die Header-Identität).
    const v1 = await withHeader(f, "/api/v1/events/view", { slug: "erste-schritte" }, visitorId);
    expect(v1.status).toBe(204);
    expect(v1.headers.get("set-cookie")).toBeNull();
    await withHeader(f, "/api/v1/events/view", { slug: "erste-schritte" }, visitorId);
    const count = f.sqlite.prepare(`SELECT COUNT(*) AS c FROM usage_events`).get() as {
      c: number;
    };
    expect(count.c).toBe(1);

    // Gefälschter Header wird ignoriert → NEUE signierte ID (Cookie gesetzt).
    const forged = await withHeader(f, "/api/v1/events/view", { slug: "erste-schritte" }, "erfunden.abc");
    expect(forged.status).toBe(204);
    expect(forged.headers.get("set-cookie")).toContain("hoh_vid=");
  });
});
