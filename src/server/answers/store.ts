import type { Citation, SourceRef } from "@/lib/content/types";

/**
 * GESPEICHERTE KI-ANTWORTEN IM KONTO (Migration 0017) — Architektur:
 * local-first bleibt der Normalfall (anonyme Nutzer, localStorage); MIT Konto
 * werden Antworten zusätzlich hier gespeichert (geräteübergreifend). Strikt
 * (tenant_id, user_id)-gebunden — dieselbe Person auf einer anderen Instanz
 * ist ein anderes Konto (Instanz-Isolation).
 *
 * Die `id` kommt vom CLIENT (stabile Antwort-Id aus der normalisierten Frage)
 * — Upsert statt Duplikat; `saved_at` (Client-Zeit) entscheidet Merges
 * (neuester Stand gewinnt, auch beim Sync-Konflikt zweier Geräte).
 */

export interface SavedAnswerRecord {
  id: string;
  question: string;
  body: string[];
  citations: Citation[];
  sourceRefs: SourceRef[];
  grounded: boolean;
  savedAt: number;
}

/** Abuse-/Speicher-Deckel (ein Konto darf D1 nicht als Datenhalde nutzen). */
export const MAX_SAVED_ANSWERS_PER_USER = 100;
const MAX_QUESTION_CHARS = 400;
const MAX_BODY_CHARS_TOTAL = 20_000;
const MAX_BODY_PARAGRAPHS = 12;
const MAX_CITATIONS = 12;
const MAX_REFS = 24;

/**
 * Body-Validierung des Upserts — bewusst streng (der Client ist unser eigener,
 * alles andere ist ein manipulierter Aufrufer): unbekannte Formen ⇒ string-
 * Fehlercode für die 400-Antwort.
 */
export function parseSavedAnswerInput(raw: unknown): SavedAnswerRecord | string {
  if (typeof raw !== "object" || raw === null) return "invalid_body";
  const o = raw as Record<string, unknown>;

  if (typeof o.id !== "string" || !/^a[0-9a-z]{1,16}$/.test(o.id)) return "invalid_id";
  if (typeof o.question !== "string") return "invalid_question";
  const question = o.question.trim().replace(/\s+/g, " ");
  if (question.length === 0 || question.length > MAX_QUESTION_CHARS) return "invalid_question";

  if (!Array.isArray(o.body) || o.body.length === 0 || o.body.length > MAX_BODY_PARAGRAPHS) {
    return "invalid_answer_body";
  }
  const body = o.body.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (body.length !== o.body.length) return "invalid_answer_body";
  if (body.reduce((n, p) => n + p.length, 0) > MAX_BODY_CHARS_TOTAL) return "invalid_answer_body";

  const citationsRaw = Array.isArray(o.citations) ? o.citations : [];
  if (citationsRaw.length > MAX_CITATIONS) return "invalid_citations";
  const citations: Citation[] = [];
  for (const c of citationsRaw) {
    const cc = c as Record<string, unknown>;
    if (typeof cc?.id !== "string" || typeof cc?.title !== "string") return "invalid_citations";
    if (cc.id.length > 80 || cc.title.length > 300) return "invalid_citations";
    citations.push({ id: cc.id, title: cc.title });
  }

  const refsRaw = Array.isArray(o.sourceRefs) ? o.sourceRefs : [];
  if (refsRaw.length > MAX_REFS) return "invalid_refs";
  const sourceRefs: SourceRef[] = [];
  for (const r of refsRaw) {
    const rr = r as Record<string, unknown>;
    if (
      typeof rr?.articleId !== "string" ||
      rr.articleId.length === 0 ||
      rr.articleId.length > 80 ||
      typeof rr?.chunkIndex !== "number" ||
      !Number.isInteger(rr.chunkIndex) ||
      rr.chunkIndex < 0 ||
      rr.chunkIndex > 999 ||
      typeof rr?.contentHash !== "string" ||
      !/^[0-9a-f]{16,64}$/.test(rr.contentHash)
    ) {
      return "invalid_refs";
    }
    sourceRefs.push({
      articleId: rr.articleId,
      chunkIndex: rr.chunkIndex,
      contentHash: rr.contentHash,
      ...(rr.kind === "roadmap" || rr.kind === "changelog" || rr.kind === "article"
        ? { kind: rr.kind }
        : {}),
    });
  }

  const savedAt =
    typeof o.savedAt === "number" && Number.isFinite(o.savedAt) && o.savedAt > 0
      ? Math.floor(o.savedAt)
      : Date.now();

  return {
    id: o.id,
    question,
    body,
    citations,
    sourceRefs,
    grounded: o.grounded !== false,
    savedAt,
  };
}

export type UpsertResult = "saved" | "limit_reached" | "stale_write";

export interface SavedAnswersRepository {
  listByUser(tenantId: string, userId: string): Promise<SavedAnswerRecord[]>;
  /**
   * Upsert der Client-Antwort. `stale_write`, wenn im Konto bereits ein
   * NEUERER Speicherstand derselben Antwort liegt (saved_at) — der Client
   * übernimmt dann beim nächsten Sync den Konto-Stand statt umgekehrt.
   */
  upsert(tenantId: string, userId: string, record: SavedAnswerRecord): Promise<UpsertResult>;
  remove(tenantId: string, userId: string, id: string): Promise<void>;
}

interface Row {
  id: string;
  question: string;
  body_json: string;
  citations_json: string;
  source_refs_json: string;
  grounded: number;
  saved_at: number;
}

function parseArray<T>(json: string): T[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export class D1SavedAnswersRepository implements SavedAnswersRepository {
  constructor(private readonly db: D1Database) {}

  async listByUser(tenantId: string, userId: string): Promise<SavedAnswerRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, question, body_json, citations_json, source_refs_json, grounded, saved_at
           FROM saved_answers
          WHERE tenant_id = ? AND user_id = ?
          ORDER BY saved_at DESC
          LIMIT ${MAX_SAVED_ANSWERS_PER_USER}`,
      )
      .bind(tenantId, userId)
      .all<Row>();
    return rows.results.map((r) => ({
      id: r.id,
      question: r.question,
      body: parseArray<string>(r.body_json),
      citations: parseArray<Citation>(r.citations_json),
      sourceRefs: parseArray<SourceRef>(r.source_refs_json),
      grounded: r.grounded === 1,
      savedAt: r.saved_at,
    }));
  }

  async upsert(
    tenantId: string,
    userId: string,
    record: SavedAnswerRecord,
  ): Promise<UpsertResult> {
    const nowSec = Math.floor(Date.now() / 1000);

    // Konto-Stand neuer? → Client-Schreibversuch ist veraltet (Merge-Regel).
    const existing = await this.db
      .prepare(`SELECT saved_at FROM saved_answers WHERE tenant_id = ? AND user_id = ? AND id = ?`)
      .bind(tenantId, userId, record.id)
      .first<{ saved_at: number }>();
    if (existing && existing.saved_at > record.savedAt) return "stale_write";

    if (!existing) {
      const count = await this.db
        .prepare(`SELECT COUNT(*) AS n FROM saved_answers WHERE tenant_id = ? AND user_id = ?`)
        .bind(tenantId, userId)
        .first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_SAVED_ANSWERS_PER_USER) return "limit_reached";
    }

    await this.db
      .prepare(
        `INSERT INTO saved_answers
           (tenant_id, user_id, id, question, body_json, citations_json, source_refs_json,
            grounded, saved_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, user_id, id) DO UPDATE SET
           question = excluded.question,
           body_json = excluded.body_json,
           citations_json = excluded.citations_json,
           source_refs_json = excluded.source_refs_json,
           grounded = excluded.grounded,
           saved_at = excluded.saved_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        tenantId,
        userId,
        record.id,
        record.question,
        JSON.stringify(record.body),
        JSON.stringify(record.citations),
        JSON.stringify(record.sourceRefs),
        record.grounded ? 1 : 0,
        record.savedAt,
        nowSec,
        nowSec,
      )
      .run();
    return "saved";
  }

  async remove(tenantId: string, userId: string, id: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM saved_answers WHERE tenant_id = ? AND user_id = ? AND id = ?`)
      .bind(tenantId, userId, id)
      .run();
  }
}
