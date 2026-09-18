/**
 * SUPPORT-TICKETS (Support-Flow, Architektur 2026-06-28) — D1-Persistenz,
 * tenant-isoliert (Migration 0015). Die Inbox im Admin ist der verlustfreie
 * Fallback; der Mail-Versand an tenants.support_email ist Best-Effort
 * (api/support.ts). Kein better-auth-Adapter — Muster branding/store.ts.
 */

export type TicketStatus = "open" | "done";

/**
 * ART der Meldung (0039):
 *   support       — „Etwas stimmt nicht?" unter einer KI-Antwort.
 *   comprehension — „Ich verstehe etwas nicht" an einer Stelle IM Artikel.
 *   ai_review     — ein angebundener KI-Client meldet eine unklare Stelle.
 *                   BEWUSST eigene Art: Eine Maschine kann davon beliebig
 *                   viele erzeugen; im selben Topf würde das seltene
 *                   menschliche Signal darin ersaufen.
 * Ein Postfach, zwei Anlässe: Ein zweites Postfach hätte bedeutet, dass ein
 * Team zwei Orte im Blick behalten muss.
 */
export type TicketKind = "support" | "comprehension" | "ai_review";

export interface SupportTicket {
  id: string;
  kind: TicketKind;
  message: string;
  contactEmail: string | null;
  question: string | null;
  /** Nur bei `comprehension`: Artikel, Block und angeklickter Text. */
  articleId: string | null;
  anchor: number | null;
  quote: string | null;
  /** Nur bei `ai_review`: der Verbesserungsvorschlag (dort Pflicht). */
  suggestion: string | null;
  status: TicketStatus;
  createdAt: number;
}

export interface NewTicket {
  tenantId: string;
  /** Fehlend = 'support' (der Bestandsfall). */
  kind?: TicketKind;
  message: string;
  contactEmail: string | null;
  question: string | null;
  articleId?: string | null;
  anchor?: number | null;
  quote?: string | null;
  suggestion?: string | null;
  actorType: "anon" | "user" | "internal";
  visitorId: string | null;
  nowSec: number;
}

export interface SupportRepository {
  create(input: NewTicket): Promise<SupportTicket>;
  /** Offene zuerst, innerhalb des Status neueste oben. */
  listByTenant(tenantId: string, limit: number): Promise<SupportTicket[]>;
  /** true = Ticket existierte im Tenant und wurde geändert. */
  setStatus(tenantId: string, id: string, status: TicketStatus): Promise<boolean>;
  /** true = Ticket existierte im Tenant und wurde gelöscht. */
  remove(tenantId: string, id: string): Promise<boolean>;
  countOpen(tenantId: string): Promise<number>;
  /** KI-Meldungen seit `sinceSec` — Grundlage des Tagesdeckels. */
  countAiReviewsSince(tenantId: string, sinceSec: number): Promise<number>;
  /** Gibt es zu dieser Stelle schon eine OFFENE KI-Meldung? */
  hasOpenAiReview(tenantId: string, articleId: string, anchor: number): Promise<boolean>;
}

interface TicketRow {
  id: string;
  kind: string | null;
  message: string;
  contact_email: string | null;
  question: string | null;
  article_id: string | null;
  anchor: number | null;
  quote: string | null;
  suggestion: string | null;
  status: TicketStatus;
  created_at: number;
}

function rowToTicket(r: TicketRow): SupportTicket {
  return {
    id: r.id,
    // Altbestand ohne Spaltenwert ist immer 'support'.
    kind:
      r.kind === "comprehension" || r.kind === "ai_review" ? r.kind : "support",
    message: r.message,
    contactEmail: r.contact_email,
    question: r.question,
    articleId: r.article_id,
    anchor: r.anchor,
    quote: r.quote,
    suggestion: r.suggestion,
    status: r.status,
    createdAt: r.created_at,
  };
}

export class D1SupportRepository implements SupportRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: NewTicket): Promise<SupportTicket> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO support_tickets
           (id, tenant_id, kind, message, contact_email, question, article_id, anchor, quote, suggestion,
            status, actor_type, visitor_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.tenantId,
        input.kind ?? "support",
        input.message,
        input.contactEmail,
        input.question,
        input.articleId ?? null,
        input.anchor ?? null,
        input.quote ?? null,
        input.suggestion ?? null,
        input.actorType,
        input.visitorId,
        input.nowSec,
        input.nowSec,
      )
      .run();
    return {
      id,
      kind: input.kind ?? "support",
      message: input.message,
      contactEmail: input.contactEmail,
      question: input.question,
      articleId: input.articleId ?? null,
      anchor: input.anchor ?? null,
      quote: input.quote ?? null,
      suggestion: input.suggestion ?? null,
      status: "open",
      createdAt: input.nowSec,
    };
  }

  async listByTenant(tenantId: string, limit: number): Promise<SupportTicket[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, kind, message, contact_email, question, article_id, anchor, quote, suggestion, status, created_at
           FROM support_tickets
          WHERE tenant_id = ?
          ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC
          LIMIT ?`,
      )
      .bind(tenantId, limit)
      .all<TicketRow>();
    return rows.results.map(rowToTicket);
  }

  async countAiReviewsSince(tenantId: string, sinceSec: number): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM support_tickets
          WHERE tenant_id = ? AND kind = 'ai_review' AND created_at >= ?`,
      )
      .bind(tenantId, sinceSec)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async hasOpenAiReview(tenantId: string, articleId: string, anchor: number): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 AS hit FROM support_tickets
          WHERE tenant_id = ? AND kind = 'ai_review' AND status = 'open'
            AND article_id = ? AND anchor = ?
          LIMIT 1`,
      )
      .bind(tenantId, articleId, anchor)
      .first<{ hit: number }>();
    return row !== null && row !== undefined;
  }

  async setStatus(tenantId: string, id: string, status: TicketStatus): Promise<boolean> {
    const res = await this.db
      .prepare(`UPDATE support_tickets SET status = ?, updated_at = unixepoch() WHERE tenant_id = ? AND id = ?`)
      .bind(status, tenantId, id)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db
      .prepare(`DELETE FROM support_tickets WHERE tenant_id = ? AND id = ?`)
      .bind(tenantId, id)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async countOpen(tenantId: string): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM support_tickets WHERE tenant_id = ? AND status = 'open'`)
      .bind(tenantId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
}
