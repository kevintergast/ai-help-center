import BetterSqlite3 from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { GRACE_DAYS } from "@/server/billing/plan-state";
import { CREDIT_COSTS, INTERNAL_AI_GENERATION_CREDITS, PLANS } from "@/server/billing/pricing";
import { D1BillingRepository } from "@/server/billing/store";
import { roadmapDoc } from "@/server/search/aux-docs";
import { buildChunks } from "@/server/search/chunking";
import { ASK_DAILY_VISITOR_CAP, answerQuestion, type AskPipelineDeps } from "./ask";

/**
 * RAG-ORCHESTRIERUNG (Kern-Invarianten, Fakes + echte Billing-DDL).
 * Verhinderte Fehlerfälle:
 *  - frozen-Tenant erzeugt AI-Kosten (Embedding/Generierung trotz Sperre).
 *  - No-Answer generiert trotzdem (Kosten + Halluzination).
 *  - Nicht-mehr-veröffentlichte Artikel leaken über alte Vektoren in den Kontext.
 *  - Credits: Generierung wird nicht/doppelt/für interne berechnet.
 *  - sourceRefs tragen nicht die Hashes der tatsächlich genutzten Chunks.
 */

const NOW = 1_800_000_000;

const ARTICLE = {
  id: "a1",
  kind: "article" as const,
  slug: "team-einladen",
  title: "Team einladen",
  body: ["Einladungen verschickt der Owner über die Team-Verwaltung."],
};

function makeFixture(over: Partial<AskPipelineDeps> = {}) {
  const sqlite = new BetterSqlite3(":memory:");
  applyMigrations(sqlite, ["0001_tenants.sql", "0009_usage_billing.sql", "0011_usage_feedback_types.sql", "0016_usage_ai_source_type.sql", "0020_usage_ai_translation_type.sql"]);
  const billing = new D1BillingRepository(d1FromSqlite(sqlite));

  const calls = { embed: 0, query: 0, generate: 0 };
  const deps: AskPipelineDeps = {
    embed: async () => {
      calls.embed += 1;
      return [0.1, 0.2, 0.3];
    },
    queryVectors: async () => {
      calls.query += 1;
      return [{ docId: "a1", kind: "article" as const, chunkIndex: 0, score: 0.9 }];
    },
    loadSources: async (_tenantId, hits) =>
      hits.some((h) => h.docId === "a1") ? [ARTICLE] : [],
    generate: async () => {
      calls.generate += 1;
      return "Der Owner verschickt Einladungen über die Team-Verwaltung.\n\nDie Eingeladenen erhalten eine E-Mail.";
    },
    billing,
    ...over,
  };
  return { deps, sqlite, billing, calls };
}

const INPUT = {
  tenantId: "t_demo",
  question: "Wie lade ich mein Team ein?",
  actor: { actorType: "anon" as const, visitorId: "v-1", userId: null },
  nowSec: NOW,
};

describe("answerQuestion", () => {
  let f: ReturnType<typeof makeFixture>;
  beforeEach(() => {
    f = makeFixture();
  });

  it("geerdeter Pfad: Antwort + Zitate + sourceRefs mit echten Chunk-Hashes + 20 Credits", async () => {
    const outcome = await answerQuestion(f.deps, INPUT);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;

    expect(outcome.answer.grounded).toBe(true);
    expect(outcome.answer.body).toHaveLength(2);
    expect(outcome.answer.citations).toEqual([
      // slug = kontextfreies Verlinken (Widget-iframe, Bauphase Widget).
      { id: "a1", title: "Team einladen", kind: "article", slug: "team-einladen" },
    ]);

    const expectedHash = (await buildChunks(ARTICLE))[0].hash;
    expect(outcome.answer.sourceRefs).toEqual([
      { articleId: "a1", chunkIndex: 0, contentHash: expectedHash, kind: "article" },
    ]);

    const usage = await f.billing.getUsage("t_demo", "2027-01");
    expect(usage.creditsUsed).toBe(CREDIT_COSTS.ai_generation);
    expect(usage.mauCount).toBe(1);
    const event = f.sqlite
      .prepare(`SELECT type, credits FROM usage_events WHERE tenant_id = 't_demo'`)
      .get();
    expect(event).toEqual({ type: "ai_generation", credits: 20 });
  });

  it("unter der Schwelle: KEINE Generierung, KEINE Credits, ehrliche No-Answer", async () => {
    f = makeFixture({
      queryVectors: async () => [{ docId: "a1", kind: "article", chunkIndex: 0, score: 0.2 }],
    });
    const outcome = await answerQuestion(f.deps, INPUT);
    expect(outcome).toMatchObject({ status: "ok", answer: { grounded: false, body: [] } });
    expect(f.calls.generate).toBe(0);
    expect((await f.billing.getUsage("t_demo", "2027-01")).creditsUsed).toBe(0);
  });

  it("Draft-Leak-Schutz: Quelle nicht (mehr) veröffentlicht → No-Answer statt Leak", async () => {
    f = makeFixture({ loadSources: async () => [] });
    const outcome = await answerQuestion(f.deps, INPUT);
    expect(outcome).toMatchObject({ status: "ok", answer: { grounded: false } });
    expect(f.calls.generate).toBe(0);
  });

  it("frozen: Abbruch VOR jedem AI-Aufruf (nicht mal das Embedding läuft)", async () => {
    f.sqlite
      .prepare(
        `INSERT INTO tenant_usage (tenant_id, period, credits_used, updated_at)
         VALUES ('t_demo', '2027-01', ?, ?)`,
      )
      .run(PLANS.free.includedCredits + 1, NOW);
    f.sqlite
      .prepare(
        `INSERT INTO tenant_plan (tenant_id, plan, over_limit_since, updated_at)
         VALUES ('t_demo', 'free', ?, ?)`,
      )
      .run(NOW - (GRACE_DAYS + 1) * 86_400, NOW);

    const outcome = await answerQuestion(f.deps, INPUT);
    expect(outcome).toEqual({ status: "frozen" });
    expect(f.calls.embed).toBe(0);
    expect(f.calls.generate).toBe(0);
  });

  it("interne (Team-)Frage: Generierung läuft zum SELBSTKOSTEN-Satz (reduziert, kein MAU)", async () => {
    const outcome = await answerQuestion(f.deps, {
      ...INPUT,
      actor: { actorType: "internal", visitorId: "u:admin", userId: "admin" },
    });
    expect(outcome.status).toBe("ok");
    // Entscheidung 2026-07-16: Team-Generierungen kosten den internen
    // At-cost-Satz (sichtbarer Verbrauch, „Nullnummer" für den Betreiber) —
    // NICHT den Endnutzer-Preis und NICHT 0.
    const usage = await f.billing.getUsage("t_demo", "2027-01");
    expect(usage).toEqual({ creditsUsed: INTERNAL_AI_GENERATION_CREDITS, mauCount: 0 });
    const event = f.sqlite
      .prepare(`SELECT credits, actor_type FROM usage_events WHERE tenant_id = 't_demo'`)
      .get();
    expect(event).toEqual({ credits: INTERNAL_AI_GENERATION_CREDITS, actor_type: "internal" });
  });

  it("Modellfehler: Exception propagiert und es wurde NICHTS verbucht", async () => {
    f = makeFixture({
      generate: async () => {
        throw new Error("model down");
      },
    });
    await expect(answerQuestion(f.deps, INPUT)).rejects.toThrow("model down");
    expect((await f.billing.getUsage("t_demo", "2027-01")).creditsUsed).toBe(0);
  });

  it("Roadmap-Quelle: geerdete Antwort mit gekennzeichnetem Zitat + hash-konsistenter Referenz", async () => {
    const item = roadmapDoc({ id: "r1", title: "Kommentare für Artikel", status: "planned" });
    f = makeFixture({
      queryVectors: async () => [{ docId: "rm:r1", kind: "roadmap", chunkIndex: 0, score: 0.8 }],
      loadSources: async (_tenantId, hits) =>
        hits.some((h) => h.docId === "rm:r1" && h.kind === "roadmap") ? [item] : [],
    });

    const outcome = await answerQuestion(f.deps, {
      ...INPUT,
      question: "Kommen Kommentare für Artikel?",
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;

    expect(outcome.answer.grounded).toBe(true);
    expect(outcome.answer.citations).toEqual([
      { id: "rm:r1", title: "Roadmap: Kommentare für Artikel", kind: "roadmap" },
    ]);
    // Hash-Konsistenz Indexierung↔Antwort: beide Seiten nutzen roadmapDoc.
    const expectedHash = (await buildChunks(item))[0].hash;
    expect(outcome.answer.sourceRefs).toEqual([
      { articleId: "rm:r1", chunkIndex: 0, contentHash: expectedHash, kind: "roadmap" },
    ]);
    // Endnutzer-Preis gilt unabhängig von der Quellen-Art.
    expect((await f.billing.getUsage("t_demo", "2027-01")).creditsUsed).toBe(
      CREDIT_COSTS.ai_generation,
    );
  });

  it("Besucher-Tagesdeckel: ab der 31. Generierung/24h visitor_capped, VOR jedem AI-Aufruf", async () => {
    const insert = f.sqlite.prepare(
      `INSERT INTO usage_events (id, tenant_id, type, credits, actor_type, visitor_id, user_id, article_id, created_at)
       VALUES (?, 't_demo', 'ai_generation', 20, 'anon', 'v-1', NULL, NULL, ?)`,
    );
    for (let i = 0; i < ASK_DAILY_VISITOR_CAP; i++) insert.run(`e-${i}`, NOW - 60 * i);

    const outcome = await answerQuestion(f.deps, INPUT);
    expect(outcome).toEqual({ status: "visitor_capped" });
    expect(f.calls.embed).toBe(0);
    expect(f.calls.generate).toBe(0);

    // Ein ANDERER Besucher (und Events älter als 24h) zählen nicht gegen den Deckel.
    const other = await answerQuestion(f.deps, {
      ...INPUT,
      actor: { ...INPUT.actor, visitorId: "v-2" },
    });
    expect(other.status).toBe("ok");
  });
});
