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
 *  - Mitgeschickte Besucher-Kennungen werden als Identität akzeptiert →
 *    Dedup-Umgehung (Credits-Sabotage) + MAU-Inflation. Seit die ID
 *    serverseitig abgeleitet wird, darf NICHTS aus dem Request sie mehr
 *    beeinflussen — und es darf kein Cookie mehr gesetzt werden.
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
  applyMigrations(sqlite, ["0001_tenants.sql", "0021_tenant_suspend.sql", "0023_logo_dark.sql", "0025_header_name.sql", "0028_widget_on_site.sql", "0031_favicon.sql", "0033_api_docs_url.sql", "0040_comprehension_mode.sql", "0041_widget_appearance.sql", "0005_content.sql", "0030_changelog_version.sql", "0018_article_images.sql", "0029_article_files.sql", "0019_article_translations.sql", "0024_article_flag.sql", "0034_article_sort.sql", "0035_entry_cards.sql", "0036_article_icon.sql", "0037_contact_methods.sql", "0038_header_actions.sql", "0043_api_docs_to_header_action.sql", "0044_prompt_suggestions.sql", "0015_support_tickets.sql", "0039_comprehension_reports.sql", "0042_review_suggestion.sql", "0009_usage_billing.sql", "0011_usage_feedback_types.sql", "0016_usage_ai_source_type.sql", "0020_usage_ai_translation_type.sql", "0026_usage_ai_video_summary.sql", "0022_plan_custom_limits.sql"]);
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

describe("Cookiefreie Besucher-IDs am Beacon", () => {
  /** Wie `post`, aber mit wählbarer Adresse/Browser (cf-connecting-ip). */
  const from = (
    f: ReturnType<typeof makeFixture>,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    f.app.request(path, {
      method: "POST",
      headers: {
        host: HOST,
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.7",
        "user-agent": "Mozilla/5.0 (Test)",
        ...headers,
      },
      body: JSON.stringify(body),
    });

  it("setzt KEIN Cookie mehr — und dedupliziert trotzdem", async () => {
    const f = makeFixture();

    const first = await from(f, "/api/v1/events/view", { slug: "erste-schritte" });
    expect(first.status).toBe(204);
    // Der eigentliche Zweck der Umstellung: nichts landet im Endgerät, also
    // braucht die Instanz auch kein Einwilligungs-Banner.
    expect(first.headers.get("set-cookie")).toBeNull();

    // Zweiter Aufruf derselben Herkunft ⇒ dieselbe abgeleitete ID ⇒ Dedup.
    await from(f, "/api/v1/events/view", { slug: "erste-schritte" });
    const events = f.sqlite.prepare(`SELECT COUNT(*) AS c FROM usage_events`).get() as {
      c: number;
    };
    expect(events.c).toBe(1);
  });

  it("mitgeschickte Kennungen ändern nichts (nichts mehr zu rotieren)", async () => {
    const f = makeFixture();
    await from(f, "/api/v1/events/view", { slug: "erste-schritte" });

    // Früher erzeugte ein erfundenes Cookie bzw. ein gefälschter Header eine
    // neue Identität (und damit eine neue MAU-Zeile). Jetzt ist die Herkunft
    // dieselbe, also bleibt es bei EINEM Event — egal was im Request steht.
    await from(f, "/api/v1/events/view", { slug: "erste-schritte" }, {
      cookie: "hoh_vid=erfunden-123",
      "x-hoh-vid": "auch-erfunden.abc",
    });
    const events = f.sqlite.prepare(`SELECT COUNT(*) AS c FROM usage_events`).get() as {
      c: number;
    };
    expect(events.c).toBe(1);

    const mau = f.sqlite.prepare(`SELECT COUNT(*) AS c FROM usage_mau`).get() as { c: number };
    expect(mau.c).toBe(1);
  });

  it("andere Herkunft = anderer Besucher (Zählung trennt weiterhin)", async () => {
    const f = makeFixture();
    await from(f, "/api/v1/events/view", { slug: "erste-schritte" });
    await from(f, "/api/v1/events/view", { slug: "erste-schritte" }, {
      "cf-connecting-ip": "198.51.100.9",
    });
    const mau = f.sqlite.prepare(`SELECT COUNT(*) AS c FROM usage_mau`).get() as { c: number };
    expect(mau.c).toBe(2);
  });

  it("Feedback-Beacon verbucht mit abgeleiteter ID (0 Credits) und antwortet 204", async () => {
    const f = makeFixture();
    const res = await from(f, "/api/v1/events/feedback", {
      slug: "erste-schritte",
      helpful: false,
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toBeNull();
    const row = f.sqlite
      .prepare(`SELECT type, credits FROM usage_events WHERE tenant_id = 't_demo'`)
      .get();
    expect(row).toEqual({ type: "feedback_unhelpful", credits: 0 });
  });
});
