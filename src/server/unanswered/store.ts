/**
 * UNBEANTWORTETE FRAGEN (0047) — Persistenz der Redaktions-Warteschlange.
 *
 * Geschrieben wird an genau zwei Stellen: automatisch, wenn die KI keine
 * belastbare Antwort findet (rag/ask.ts), und manuell, wenn ein Nutzer
 * „Ich brauche dazu eine Antwort" drückt (api/unanswered.ts).
 *
 * ISOLATIONS-INVARIANTE wie überall: JEDE Query ist über `tenant_id = ?`
 * gebunden, und die Id kommt aus der Host-Auflösung, nie aus dem Body.
 */

/** Wortlaut-Deckel. Länger fragt niemand ernsthaft, und die Liste bleibt lesbar. */
export const MAX_QUESTION_CHARS = 400;

/**
 * Aufbewahrung. 90 Tage sind lang genug, dass sich eine Häufung zeigt, und
 * kurz genug, dass wir keine Fragetext-Halde anlegen. Durchgesetzt wird sie
 * BEIM SCHREIBEN — ein Cron, der irgendwann läuft, wäre eine zweite bewegliche
 * Sache für eine Tabelle, die ohnehin nur wächst, wenn jemand fragt.
 */
export const RETENTION_DAYS = 90;
const RETENTION_SEC = RETENTION_DAYS * 24 * 60 * 60;

/**
 * Normalisierung für die Gruppierung: klein, ohne Satzzeichen, ohne
 * Mehrfach-Leerzeichen. BEWUSST simpel — die Liste soll „dieselbe Frage,
 * fünfmal gestellt" zusammenfassen, nicht Synonyme erkennen. Ein
 * Ähnlichkeitsmaß hier wäre eine zweite, schlechtere Suchmaschine neben der
 * echten (Vectorize).
 */
export function questionKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUESTION_CHARS);
}

/** Eine Gruppe gleicher Fragen für die Verwaltungs-Ansicht. */
export interface UnansweredGroup {
  /** Zuletzt gestellter Wortlaut der Gruppe (Anzeige). */
  question: string;
  /** Wie oft im Aufbewahrungsfenster gefragt. */
  count: number;
  /** Hat mindestens einer aktiv um eine Antwort gebeten? */
  reported: boolean;
  /** Freiwillige Adressen der Meldenden (leer, wenn niemand eine ließ). */
  emails: string[];
  lastAskedAt: number;
}

export interface UnansweredRepository {
  /** Automatisch beim Ausbleiben einer Antwort. */
  record(input: { tenantId: string; question: string; nowSec: number }): Promise<void>;
  /**
   * „Ich brauche dazu eine Antwort". Hebt den jüngsten passenden Eintrag an,
   * statt eine zweite Zeile anzulegen — sonst zählte dieselbe Frage doppelt,
   * nur weil jemand zusätzlich gemeldet hat.
   */
  report(input: {
    tenantId: string;
    question: string;
    email: string | null;
    nowSec: number;
  }): Promise<void>;
  /** Gruppiert, gemeldete zuerst, danach nach Häufigkeit. */
  list(tenantId: string, limit: number): Promise<UnansweredGroup[]>;
}

export class D1UnansweredRepository implements UnansweredRepository {
  constructor(private readonly db: D1Database) {}

  async record(input: { tenantId: string; question: string; nowSec: number }): Promise<void> {
    const question = input.question.trim().slice(0, MAX_QUESTION_CHARS);
    if (question.length === 0) return;
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO unanswered_questions (id, tenant_id, question, question_key, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), input.tenantId, question, questionKey(question), input.nowSec),
      this.deleteExpired(input.tenantId, input.nowSec),
    ]);
  }

  async report(input: {
    tenantId: string;
    question: string;
    email: string | null;
    nowSec: number;
  }): Promise<void> {
    const question = input.question.trim().slice(0, MAX_QUESTION_CHARS);
    if (question.length === 0) return;
    const key = questionKey(question);

    // Jüngsten Eintrag derselben Frage anheben (der stammt vom Ask-Aufruf,
    // der gerade zu dieser Meldung geführt hat).
    const existing = await this.db
      .prepare(
        `SELECT id FROM unanswered_questions
          WHERE tenant_id = ? AND question_key = ?
          ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(input.tenantId, key)
      .first<{ id: string }>();

    if (existing) {
      await this.db
        .prepare(
          `UPDATE unanswered_questions SET reported = 1, contact_email = COALESCE(?, contact_email)
            WHERE tenant_id = ? AND id = ?`,
        )
        .bind(input.email, input.tenantId, existing.id)
        .run();
      return;
    }

    // Kein Eintrag da (Aufräumen dazwischen, oder gemeldet ohne vorherige
    // Frage): eigene Zeile, damit die Meldung nicht verloren geht.
    await this.db
      .prepare(
        `INSERT INTO unanswered_questions
           (id, tenant_id, question, question_key, reported, contact_email, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(crypto.randomUUID(), input.tenantId, question, key, input.email, input.nowSec)
      .run();
  }

  async list(tenantId: string, limit: number): Promise<UnansweredGroup[]> {
    const { results } = await this.db
      .prepare(
        `SELECT question_key,
                COUNT(*)                    AS n,
                MAX(reported)               AS reported,
                MAX(created_at)             AS last_asked,
                GROUP_CONCAT(DISTINCT contact_email) AS emails
           FROM unanswered_questions
          WHERE tenant_id = ?
          GROUP BY question_key
          ORDER BY reported DESC, n DESC, last_asked DESC
          LIMIT ?`,
      )
      .bind(tenantId, limit)
      .all<{
        question_key: string;
        n: number;
        reported: number;
        last_asked: number;
        emails: string | null;
      }>();

    // Anzeige-Wortlaut je Gruppe: der ZULETZT gestellte. Ältere Formulierungen
    // derselben Frage sind für die Redaktion uninteressant.
    const groups: UnansweredGroup[] = [];
    for (const r of results) {
      const latest = await this.db
        .prepare(
          `SELECT question FROM unanswered_questions
            WHERE tenant_id = ? AND question_key = ?
            ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(tenantId, r.question_key)
        .first<{ question: string }>();
      groups.push({
        question: latest?.question ?? r.question_key,
        count: r.n,
        reported: r.reported === 1,
        emails: (r.emails ?? "").split(",").filter((e) => e.length > 0),
        lastAskedAt: r.last_asked,
      });
    }
    return groups;
  }

  private deleteExpired(tenantId: string, nowSec: number) {
    return this.db
      .prepare(`DELETE FROM unanswered_questions WHERE tenant_id = ? AND created_at < ?`)
      .bind(tenantId, nowSec - RETENTION_SEC);
  }
}
