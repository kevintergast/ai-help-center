import type { AskAnswer, SourceRef } from "@/lib/content/types";
import { readPlanState, type BillingRepository, type UsageActorType } from "@/server/billing/store";
import { buildChunks } from "@/server/search/chunking";
import type { SourceKind } from "@/server/search/indexer";
import { buildAskMessages, splitAnswerParagraphs, type ChatMessage } from "./generate";
import { assessGrounding, type RetrievalMatch } from "./grounding";

/**
 * DYNAMISCHER KI-ARTIKEL (RAG-Kern, „Punkt 3") — Orchestrierung mit
 * injizierten Abhängigkeiten (vollständig mit Fakes testbar):
 *
 *   Frage → [frozen-Gate] → Query-Embedding → Vectorize (Tenant-Namespace)
 *        → Grounding-Schwelle → Kontext aus VERÖFFENTLICHTEN D1-Artikeln
 *        → Generierung (Workers AI via Gateway) → 20 Credits verbuchen.
 *
 * SICHERHEITS-/KOSTEN-INVARIANTEN:
 *  - `frozen` blockiert VOR jedem AI-Aufruf (nicht mal das Embedding läuft).
 *  - Nicht geerdet ⇒ KEINE Generierung, KEINE Credits (ehrliche No-Answer
 *    statt Halluzination — Trust-Schicht der Architektur).
 *  - Kontext-Text kommt NIE aus Vectorize-Metadaten, sondern wird aus den
 *    aktuell VERÖFFENTLICHTEN Artikeln rekonstruiert: veraltete Vektoren von
 *    Entwürfen/gelöschten Artikeln können keinen Inhalt leaken (fail-closed);
 *    verschwinden dabei alle Quellen, kippt die Antwort auf No-Answer.
 *  - Credits erst NACH erfolgreicher Generierung (kein Charge für Fehler);
 *    `sourceRefs` tragen die content_hashes der Generierung (Staleness-Basis).
 */

export interface VectorHit {
  /** Artikel-Id oder Pseudo-Id (`rm:`/`cl:` — Roadmap/Changelog). */
  docId: string;
  kind: SourceKind;
  chunkIndex: number;
  score: number;
}

/** Ladbares Quell-Dokument (Artikel ODER Roadmap-/Changelog-Pseudo-Dokument). */
export interface SourceDoc {
  id: string;
  kind: SourceKind;
  slug: string;
  title: string;
  body: string[];
}

export interface AskActor {
  actorType: UsageActorType;
  visitorId: string;
  userId: string | null;
}

export interface AskPipelineDeps {
  /** Query-Embedding (bge-m3 via Gateway; Tests: deterministischer Fake). */
  embed(text: string): Promise<number[]>;
  /** Vectorize-Query im TENANT-Namespace (Belt-and-Suspenders zur Metadaten-Filterung). */
  queryVectors(tenantId: string, vector: number[]): Promise<VectorHit[]>;
  /**
   * Quell-Dokumente zu Treffern laden — Artikel NUR veröffentlicht (Draft-
   * Leak-Schutz liegt in dieser Query); Roadmap/Changelog über die geteilten
   * aux-docs-Builder (Hash-Konsistenz zur Indexierung).
   */
  loadSources(tenantId: string, hits: VectorHit[]): Promise<SourceDoc[]>;
  /** Chat-Generierung (llama via Gateway); wirft bei Modellfehlern. */
  generate(messages: ChatMessage[]): Promise<string>;
  /** Metering (null = keine D1-Bindings, dev → nichts verbuchen, nie gaten). */
  billing: BillingRepository | null;
}

export interface AskInput {
  tenantId: string;
  question: string;
  actor: AskActor;
  nowSec: number;
}

export type AskOutcome =
  | { status: "ok"; answer: AskAnswer }
  | { status: "frozen" }
  | { status: "visitor_capped" };

/**
 * Tagesdeckel KI-Generierungen PRO BESUCHER (Abuse-Härtung): begrenzt, was
 * eine einzelne (signierte!) Besucher-ID an LLM-Kosten auslösen kann. 30/Tag
 * ist für echte Endnutzer unsichtbar hoch; Skripte laufen dagegen. Rotation
 * der ID scheitert an Signatur + IP-Rate-Limit (visitor-id.ts, rate-limit.ts).
 */
export const ASK_DAILY_VISITOR_CAP = 30;

export async function answerQuestion(deps: AskPipelineDeps, input: AskInput): Promise<AskOutcome> {
  // 1) Plan-Gate VOR jedem AI-Aufruf (Kosten-Leitplanke): eingefrorene Tenants
  //    generieren nicht. over_limit läuft in der Kulanzzeit bewusst weiter.
  //    Danach der Besucher-Tagesdeckel (ebenfalls VOR Embedding/Retrieval).
  if (deps.billing) {
    const state = await readPlanState(deps.billing, input.tenantId, input.nowSec);
    if (state.status === "frozen") return { status: "frozen" };
    const used = await deps.billing.countAiGenerationsSince(
      input.tenantId,
      input.actor.visitorId,
      input.nowSec - 24 * 60 * 60,
    );
    if (used >= ASK_DAILY_VISITOR_CAP) return { status: "visitor_capped" };
  }

  const noAnswer: AskAnswer = {
    question: input.question,
    body: [],
    citations: [],
    grounded: false,
    sourceRefs: [],
  };

  // 2) Retrieval + Grounding-Schwelle.
  const vector = await deps.embed(input.question);
  const hits = await deps.queryVectors(input.tenantId, vector);
  const grounding = assessGrounding(hits);
  if (!grounding.grounded) {
    // Kalibrier-Log (datenschutz-sauber: Scores/Längen, NIE der Fragetext) —
    // damit sich die Grounding-Schwelle an echten No-Answers justieren lässt.
    const top = [...hits].sort((a, b) => b.score - a.score).slice(0, 3);
    console.log(
      `[ask] not-grounded tenant=${input.tenantId} qlen=${input.question.length} top=[${top
        .map((h) => `${h.docId}#${h.chunkIndex}:${h.score.toFixed(3)}`)
        .join(", ")}]`,
    );
    return { status: "ok", answer: noAnswer };
  }

  // 3) Kontext aus den AKTUELLEN Quellen rekonstruieren (Artikel: nur
  //    veröffentlicht; Roadmap/Changelog: aktueller Datenstand). `kind` kommt
  //    aus den Roh-Treffern (Grounding kennt nur docId+Score).
  const kindByDoc = new Map(hits.map((h) => [h.docId, h.kind]));
  const selectedHits: VectorHit[] = grounding.selected.map((m) => ({
    docId: m.docId,
    kind: kindByDoc.get(m.docId) ?? "article",
    chunkIndex: m.chunkIndex,
    score: m.score,
  }));
  const docs = new Map(
    (await deps.loadSources(input.tenantId, selectedHits)).map((d) => [d.id, d]),
  );

  const context: { match: RetrievalMatch; doc: SourceDoc; text: string; hash: string }[] = [];
  for (const match of grounding.selected) {
    const doc = docs.get(match.docId);
    if (!doc) continue; // nicht (mehr) vorhanden/veröffentlicht → Quelle entfällt
    const chunks = await buildChunks(doc);
    const chunk = chunks[match.chunkIndex];
    if (!chunk) continue; // Quelle wurde kürzer als der indexierte Stand
    context.push({ match, doc, text: chunk.text, hash: chunk.hash });
  }
  if (context.length === 0) return { status: "ok", answer: noAnswer };

  // 4) Generierung.
  const messages = buildAskMessages(
    input.question,
    context.map((c, i) => ({ index: i + 1, articleTitle: c.doc.title, text: c.text })),
  );
  const body = splitAnswerParagraphs(await deps.generate(messages));
  if (body.length === 0) return { status: "ok", answer: noAnswer };

  // 5) Zitate (je Quelle einmal, in Treffer-Reihenfolge; kind steuert die
  //    Darstellung im Client) + Staleness-Referenzen.
  const citations: AskAnswer["citations"] = [];
  const cited = new Set<string>();
  const sourceRefs: SourceRef[] = [];
  for (const c of context) {
    if (!cited.has(c.doc.id)) {
      cited.add(c.doc.id);
      citations.push({
        id: c.doc.id,
        title: c.doc.title,
        kind: c.doc.kind,
        // Artikel-Slug fürs kontextfreie Verlinken (Widget öffnet /<slug> im neuen Tab).
        ...(c.doc.kind === "article" && c.doc.slug ? { slug: c.doc.slug } : {}),
      });
    }
    sourceRefs.push({
      articleId: c.doc.id,
      chunkIndex: c.match.chunkIndex,
      contentHash: c.hash,
      kind: c.doc.kind,
    });
  }

  // 6) Verbuchen — NACH erfolgreicher Generierung (interne Nutzer: reduzierter
  //    Selbstkosten-Satz statt Endnutzer-Preis, s. pricing.creditsFor).
  //    citedArticleIds: NUR echte Artikel (kind article) → ai_source-Events
  //    („Häufigste Quellen" + Score-Basis); Roadmap/Changelog-Pseudo-Docs
  //    bleiben bewusst draußen (kein Artikel, kein Beitrags-Score).
  if (deps.billing) {
    await deps.billing.recordAiGeneration({
      tenantId: input.tenantId,
      actorType: input.actor.actorType,
      visitorId: input.actor.visitorId,
      userId: input.actor.userId,
      nowSec: input.nowSec,
      citedArticleIds: citations.filter((c) => c.kind === "article").map((c) => c.id),
    });
  }

  return {
    status: "ok",
    answer: { question: input.question, body, citations, grounded: true, sourceRefs },
  };
}
