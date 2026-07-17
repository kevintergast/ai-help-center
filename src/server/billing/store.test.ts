import BetterSqlite3 from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { GRACE_DAYS } from "./plan-state";
import { CREDIT_COSTS, creditsFor, INTERNAL_AI_GENERATION_CREDITS, PLANS } from "./pricing";
import { D1BillingRepository, readPlanState, VIEW_DEDUP_WINDOW_SEC } from "./store";

/**
 * METERING-PERSISTENZ gegen die ECHTE Migrations-DDL (0001+0005+0009 via
 * better-sqlite3-Shim — Muster team-persistence.test.ts). Verhinderte Fehler:
 *  - Draft-/fremde Artikel erzeugen Credits (Leak übers Beacon).
 *  - Reload-/Refresh-Spam bläht Credits auf (Dedup-Fenster wirkungslos).
 *  - Team-Aufrufe kosten den Tenant Geld oder zählen als MAU.
 *  - MAU zählt denselben Besucher mehrfach (kein Dedup) oder cross-tenant.
 *  - over_limit-Marker verlängert die Grace bei jeder Buchung (COALESCE-Bug)
 *    oder bleibt nach Erholung (neue Periode) fälschlich stehen.
 */

const NOW = 1_800_000_000;
const DAY = 86_400;

function setup() {
  const sqlite = new BetterSqlite3(":memory:");
  applyMigrations(sqlite, [
    "0001_tenants.sql",
    "0005_content.sql", "0018_article_images.sql", "0019_article_translations.sql",
    "0009_usage_billing.sql",
    "0011_usage_feedback_types.sql", "0016_usage_ai_source_type.sql", "0020_usage_ai_translation_type.sql",
    "0012_enterprise_plan.sql",
  ]);
  // Publizierter Artikel je Tenant (+ ein Draft) — Grundlage der View-Buchung.
  const insert = sqlite.prepare(
    `INSERT INTO articles (id, tenant_id, slug, title, category, status)
     VALUES (?, ?, ?, ?, 'Test', ?)`,
  );
  insert.run("a1", "t_demo", "erste-schritte", "Erste Schritte", "published");
  insert.run("a2", "t_demo", "entwurf", "Entwurf", "draft");
  insert.run("a1", "t_acme", "getting-started", "Getting Started", "published");
  const repo = new D1BillingRepository(d1FromSqlite(sqlite));
  return { sqlite, repo };
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

const view = (over: Partial<Parameters<D1BillingRepository["recordView"]>[0]> = {}) =>
  ctx.repo.recordView({
    tenantId: "t_demo",
    slug: "erste-schritte",
    actorType: "anon",
    visitorId: "v-1",
    nowSec: NOW,
    ...over,
  });

describe("recordView — Verbuchung, Dedup, Isolation", () => {
  it("published-Artikel: Event + 1 Credit + MAU; Draft/unbekannt: NICHTS", async () => {
    expect((await view()).result).toBe("recorded");
    expect((await view({ slug: "entwurf", visitorId: "v-2" })).result).toBe("unknown_article");
    expect((await view({ slug: "gibts-nicht", visitorId: "v-3" })).result).toBe("unknown_article");

    const usage = await ctx.repo.getUsage("t_demo", "2027-01");
    expect(usage).toEqual({ creditsUsed: 1, mauCount: 1 });
  });

  it("Dedup: gleicher Besucher+Artikel im Fenster zählt EINMAL; danach wieder", async () => {
    expect((await view()).result).toBe("recorded");
    expect((await view({ nowSec: NOW + 60 })).result).toBe("deduped");
    expect((await view({ nowSec: NOW + VIEW_DEDUP_WINDOW_SEC + 1 })).result).toBe("recorded");

    const usage = await ctx.repo.getUsage("t_demo", "2027-01");
    expect(usage.creditsUsed).toBe(2);
    expect(usage.mauCount).toBe(1); // derselbe Besucher bleibt EIN MAU
  });

  it("internal (Team): Event ja, aber 0 Credits und KEIN MAU", async () => {
    await view({ actorType: "internal", visitorId: "u:admin1", userId: "admin1" });
    const usage = await ctx.repo.getUsage("t_demo", "2027-01");
    expect(usage).toEqual({ creditsUsed: 0, mauCount: 0 });
    // Event ist trotzdem da (Statistik-Filter „interne ausblenden").
    const events = ctx.sqlite
      .prepare(`SELECT actor_type, credits FROM usage_events WHERE tenant_id = 't_demo'`)
      .all();
    expect(events).toEqual([{ actor_type: "internal", credits: 0 }]);
  });

  it("Tenant-Isolation: acme-Views tauchen in demo-Usage/Stats NIE auf", async () => {
    await view();
    await view({ tenantId: "t_acme", slug: "getting-started", visitorId: "v-1" });

    expect((await ctx.repo.getUsage("t_demo", "2027-01")).creditsUsed).toBe(1);
    expect((await ctx.repo.getUsage("t_acme", "2027-01")).creditsUsed).toBe(1);

    const top = await ctx.repo.getTopArticles(
      "t_demo",
      { days: 30, excludeInternal: true, nowSec: NOW },
      10,
    );
    expect(top).toEqual([{ articleId: "a1", title: "Erste Schritte", views: 1 }]);
  });
});

describe("over_limit-Marker + Statuskette am Store", () => {
  it("Limit-Überschreitung setzt den Marker EINMAL (Grace verlängert sich nicht)", async () => {
    // Free-Limit direkt per Aggregat überschreiten (1000 Einzel-Views wären Test-Lärm).
    ctx.sqlite
      .prepare(
        `INSERT INTO tenant_usage (tenant_id, period, credits_used, updated_at)
         VALUES ('t_demo', '2027-01', ?, ?)`,
      )
      .run(PLANS.free.includedCredits, NOW);

    // Diese Buchung kippt über das Limit → Marker = NOW.
    await view();
    let row = await ctx.repo.getPlanRow("t_demo");
    expect(row.overLimitSince).toBe(NOW);

    // Spätere Buchung darf den Beginn NICHT verschieben (COALESCE).
    await view({ visitorId: "v-2", nowSec: NOW + 5 * DAY });
    row = await ctx.repo.getPlanRow("t_demo");
    expect(row.overLimitSince).toBe(NOW);

    const state = await readPlanState(ctx.repo, "t_demo", NOW + 5 * DAY);
    expect(state.status).toBe("over_limit");
    expect(state.graceDaysLeft).toBe(GRACE_DAYS - 5);
  });

  it("neue Periode unterm Limit → Marker wird gelöscht, Status active", async () => {
    ctx.sqlite
      .prepare(
        `INSERT INTO tenant_plan (tenant_id, plan, over_limit_since, updated_at)
         VALUES ('t_demo', 'free', ?, ?)`,
      )
      .run(NOW - 40 * DAY, NOW - 40 * DAY);

    // Buchung in der NEUEN Periode (Zähler dort = 1 → im Limit) → sync löscht.
    await view();
    const row = await ctx.repo.getPlanRow("t_demo");
    expect(row.overLimitSince).toBeNull();
    expect((await readPlanState(ctx.repo, "t_demo", NOW)).status).toBe("active");
  });
});

describe("Statistik-Leseseite", () => {
  it("Tagesserie füllt Lücken mit 0 und filtert interne Aufrufe", async () => {
    await view(); // heute, anon
    await view({ visitorId: "v-2", nowSec: NOW - 2 * DAY }); // vorgestern
    await view({ actorType: "internal", visitorId: "u:x", nowSec: NOW }); // intern

    const series = await ctx.repo.getDailyViews("t_demo", {
      days: 3,
      excludeInternal: true,
      nowSec: NOW,
    });
    expect(series).toEqual([1, 0, 1]);

    const withInternal = await ctx.repo.getDailyViews("t_demo", {
      days: 3,
      excludeInternal: false,
      nowSec: NOW,
    });
    expect(withInternal).toEqual([1, 0, 2]);

    expect(
      await ctx.repo.getViewTotal("t_demo", { days: 3, excludeInternal: true, nowSec: NOW }),
    ).toBe(2);
  });
});

const feedback = (over: Partial<Parameters<D1BillingRepository["recordFeedback"]>[0]> = {}) =>
  ctx.repo.recordFeedback({
    tenantId: "t_demo",
    slug: "erste-schritte",
    helpful: true,
    actorType: "anon",
    visitorId: "v-1",
    nowSec: NOW,
    ...over,
  });

describe("recordFeedback — Dedup, Ziel-Auflösung, 0 Credits", () => {
  it("Artikel-Feedback: Event ohne Credits/MAU; unbekannter/Draft-Slug wird verworfen", async () => {
    await feedback();
    await feedback({ slug: "entwurf", visitorId: "v-2" });
    await feedback({ slug: "gibts-nicht", visitorId: "v-3" });

    const rows = ctx.sqlite
      .prepare(`SELECT type, credits, article_id FROM usage_events WHERE tenant_id = 't_demo'`)
      .all();
    expect(rows).toEqual([{ type: "feedback_helpful", credits: 0, article_id: "a1" }]);
    // Feedback erzeugt weder Credits noch MAU (würde sonst Billing verfälschen).
    expect(await ctx.repo.getUsage("t_demo", "2027-01")).toEqual({
      creditsUsed: 0,
      mauCount: 0,
    });
  });

  it("Dedup 24h gleiche Richtung; Gegenrichtung + neuer Tag zählen", async () => {
    await feedback();
    await feedback({ nowSec: NOW + 60 }); // Klick-Spam → verworfen
    await feedback({ helpful: false, nowSec: NOW + 120 }); // Meinungswechsel → zählt
    await feedback({ nowSec: NOW + DAY + 1 }); // nach Ablauf des Fensters → zählt

    const n = ctx.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM usage_events WHERE tenant_id = 't_demo'`)
      .get() as { n: number };
    expect(n.n).toBe(3);
  });

  it("Antwort-Feedback (slug null) landet mit article_id NULL im Aggregat", async () => {
    await feedback({ slug: null, helpful: false });
    const stats = await ctx.repo.getFeedbackStats("t_demo", {
      days: 1,
      excludeInternal: true,
      nowSec: NOW,
    });
    expect(stats.answers).toEqual({ helpful: 0, unhelpful: 1 });
    expect(stats.byArticle).toEqual({});
  });

  it("getFeedbackStats aggregiert je Artikel und blendet interne aus", async () => {
    await feedback(); // anon, hilfreich
    await feedback({ visitorId: "v-2", helpful: false });
    await feedback({ visitorId: "u:admin", actorType: "internal" }); // intern

    const stats = await ctx.repo.getFeedbackStats("t_demo", {
      days: 1,
      excludeInternal: true,
      nowSec: NOW,
    });
    expect(stats.byArticle).toEqual({ a1: { helpful: 1, unhelpful: 1 } });

    const withInternal = await ctx.repo.getFeedbackStats("t_demo", {
      days: 1,
      excludeInternal: false,
      nowSec: NOW,
    });
    expect(withInternal.byArticle).toEqual({ a1: { helpful: 2, unhelpful: 1 } });
  });

  it("Feedback unterdrückt das View-Dedup NICHT (Typ-Filter im Fenster)", async () => {
    await feedback();
    expect((await view()).result).toBe("recorded");
  });
});

describe("creditsFor — zentrale Preisregel nach Akteurs-Klasse", () => {
  it("Endnutzer zahlen Listenpreis; Team nur KI-Generierungen zum Selbstkosten-Satz", () => {
    expect(creditsFor("article_view", "anon")).toBe(CREDIT_COSTS.article_view);
    expect(creditsFor("ai_generation", "user")).toBe(CREDIT_COSTS.ai_generation);
    expect(creditsFor("article_view", "internal")).toBe(0);
    expect(creditsFor("feedback_helpful", "internal")).toBe(0);
    expect(creditsFor("ai_generation", "internal")).toBe(INTERNAL_AI_GENERATION_CREDITS);
    expect(creditsFor("ai_regeneration", "internal")).toBe(INTERNAL_AI_GENERATION_CREDITS);
    // Der Selbstkosten-Satz ist bewusst ein Bruchteil des Endnutzer-Preises.
    expect(INTERNAL_AI_GENERATION_CREDITS).toBeLessThan(CREDIT_COSTS.ai_generation);
  });

  it("interne KI-Generierung erhöht das Credit-Aggregat (aber KEIN MAU)", async () => {
    await ctx.repo.recordAiGeneration({
      tenantId: "t_demo",
      actorType: "internal",
      visitorId: "u:owner",
      userId: "owner",
      nowSec: NOW,
    });
    expect(await ctx.repo.getUsage("t_demo", "2027-01")).toEqual({
      creditsUsed: INTERNAL_AI_GENERATION_CREDITS,
      mauCount: 0,
    });
  });
});

describe("Enterprise-Plan (0012)", () => {
  it("tenant_plan akzeptiert 'enterprise' und der Plan-State rechnet mit Enterprise-Limits", async () => {
    ctx.sqlite
      .prepare(
        `INSERT INTO tenant_plan (tenant_id, plan, updated_at) VALUES ('t_demo', 'enterprise', ?)`,
      )
      .run(NOW);
    // Verbrauch weit über Scale (150k), aber unter Enterprise (1M) → active.
    ctx.sqlite
      .prepare(
        `INSERT INTO tenant_usage (tenant_id, period, credits_used, updated_at)
         VALUES ('t_demo', '2027-01', 200000, ?)`,
      )
      .run(NOW);

    const state = await readPlanState(ctx.repo, "t_demo", NOW);
    expect(state.plan.id).toBe("enterprise");
    expect(state.status).toBe("active");
  });
});

describe("countAiGenerationsSince (Besucher-Tagesdeckel)", () => {
  it("zählt nur ai_generation des Besuchers im Fenster, tenant-scoped", async () => {
    const insert = ctx.sqlite.prepare(
      `INSERT INTO usage_events (id, tenant_id, type, credits, actor_type, visitor_id, user_id, article_id, created_at)
       VALUES (?, ?, ?, 20, 'anon', ?, NULL, NULL, ?)`,
    );
    insert.run("g1", "t_demo", "ai_generation", "v-1", NOW - 60);
    insert.run("g2", "t_demo", "ai_generation", "v-1", NOW - 120);
    insert.run("g3", "t_demo", "ai_generation", "v-1", NOW - 2 * DAY); // zu alt
    insert.run("g4", "t_demo", "ai_generation", "v-2", NOW - 60); // anderer Besucher
    insert.run("g5", "t_acme", "ai_generation", "v-1", NOW - 60); // anderer Tenant
    insert.run("g6", "t_demo", "article_view", "v-1", NOW - 60); // anderer Typ

    expect(await ctx.repo.countAiGenerationsSince("t_demo", "v-1", NOW - DAY)).toBe(2);
  });
});

describe("ai_source-Events + getTopSources (Häufigste Quellen)", () => {
  it("recordAiGeneration schreibt je zitiertem Artikel EIN 0-Credit-Quell-Event (dedupliziert)", async () => {
    await ctx.repo.recordAiGeneration({
      tenantId: "t_demo",
      actorType: "anon",
      visitorId: "v-1",
      nowSec: NOW,
      citedArticleIds: ["a1", "a1", "a2"], // Duplikat wird verworfen
    });

    const rows = ctx.sqlite
      .prepare(
        `SELECT type, credits, article_id FROM usage_events
          WHERE tenant_id = 't_demo' ORDER BY type, article_id`,
      )
      .all();
    expect(rows).toEqual([
      { type: "ai_generation", credits: 20, article_id: null },
      { type: "ai_source", credits: 0, article_id: "a1" },
      { type: "ai_source", credits: 0, article_id: "a2" },
    ]);
    // Quell-Events erhöhen weder Credits noch MAU über die Generierung hinaus.
    expect(await ctx.repo.getUsage("t_demo", "2027-01")).toEqual({
      creditsUsed: 20,
      mauCount: 1,
    });
  });

  it("getTopSources aggregiert je Artikel mit Titel, filtert intern + Fenster + Tenant", async () => {
    const gen = (visitorId: string, cited: string[], over: { actorType?: "anon" | "internal"; nowSec?: number; tenantId?: string } = {}) =>
      ctx.repo.recordAiGeneration({
        tenantId: over.tenantId ?? "t_demo",
        actorType: over.actorType ?? "anon",
        visitorId,
        nowSec: over.nowSec ?? NOW,
        citedArticleIds: cited,
      });

    await gen("v-1", ["a1", "a2"]);
    await gen("v-2", ["a1"]);
    await gen("u:admin", ["a2"], { actorType: "internal" }); // intern → gefiltert
    await gen("v-3", ["a1"], { nowSec: NOW - 40 * DAY }); // außerhalb Fenster
    await gen("v-4", ["a1"], { tenantId: "t_acme" }); // fremder Tenant

    const top = await ctx.repo.getTopSources(
      "t_demo",
      { days: 30, excludeInternal: true, nowSec: NOW },
      5,
    );
    expect(top).toEqual([
      { articleId: "a1", title: "Erste Schritte", views: 2 },
      { articleId: "a2", title: "Entwurf", views: 1 },
    ]);

    const withInternal = await ctx.repo.getTopSources(
      "t_demo",
      { days: 30, excludeInternal: false, nowSec: NOW },
      5,
    );
    expect(withInternal.find((r) => r.articleId === "a2")?.views).toBe(2);
  });
});
