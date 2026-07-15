import BetterSqlite3 from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { GRACE_DAYS } from "./plan-state";
import { PLANS } from "./pricing";
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
  applyMigrations(sqlite, ["0001_tenants.sql", "0005_content.sql", "0009_usage_billing.sql"]);
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
