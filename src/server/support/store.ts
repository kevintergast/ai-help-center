/**
 * SUPPORT-TICKETS (Support-Flow, Architektur 2026-06-28) — D1-Persistenz,
 * tenant-isoliert (Migration 0015). Die Inbox im Admin ist der verlustfreie
 * Fallback; der Mail-Versand an tenants.support_email ist Best-Effort
 * (api/support.ts). Kein better-auth-Adapter — Muster branding/store.ts.
 */

export type TicketStatus = "open" | "done";

export interface SupportTicket {
  id: string;
  message: string;
  contactEmail: string | null;
  question: string | null;
  status: TicketStatus;
  createdAt: number;
}

export interface NewTicket {
  tenantId: string;
  message: string;
  contactEmail: string | null;
  question: string | null;
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
}

interface TicketRow {
  id: string;
  message: string;
  contact_email: string | null;
  question: string | null;
  status: TicketStatus;
  created_at: number;
}

function rowToTicket(r: TicketRow): SupportTicket {
  return {
    id: r.id,
    message: r.message,
    contactEmail: r.contact_email,
    question: r.question,
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
           (id, tenant_id, message, contact_email, question, status, actor_type, visitor_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.tenantId,
        input.message,
        input.contactEmail,
        input.question,
        input.actorType,
        input.visitorId,
        input.nowSec,
        input.nowSec,
      )
      .run();
    return {
      id,
      message: input.message,
      contactEmail: input.contactEmail,
      question: input.question,
      status: "open",
      createdAt: input.nowSec,
    };
  }

  async listByTenant(tenantId: string, limit: number): Promise<SupportTicket[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, message, contact_email, question, status, created_at
           FROM support_tickets
          WHERE tenant_id = ?
          ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC
          LIMIT ?`,
      )
      .bind(tenantId, limit)
      .all<TicketRow>();
    return rows.results.map(rowToTicket);
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
