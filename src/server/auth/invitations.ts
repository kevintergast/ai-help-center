/**
 * EINLADUNGS-PERSISTENZ (Phase D, Design §c.4) — Muster: branding/store.ts.
 *
 * Interface + D1-Implementierung für `auth_invitation` (migrations/0002_auth.sql).
 * BEWUSST NICHT über den better-auth-Adapter: der tenantAwareAdapter ist
 * default-deny für unbekannte Modelle (würde werfen — Absicht). Stattdessen
 * eigene, überall tenant-gebundene Queries (`WHERE tenant_id = ?`), exakt wie
 * das DDL es mit den Composite-/Partial-Indizes vorsieht (T-4).
 *
 * TOKEN-DISZIPLIN:
 *  - Das Roh-Token (32 Bytes CSPRNG, base64url) existiert NUR in der
 *    Einladungs-Mail (bzw. dev-only im `devAcceptUrl`-Response-Feld).
 *  - Die DB speichert ausschließlich sha256(token) als Hex — ein DB-Leak
 *    verrät keine einlösbaren Tokens.
 *  - Lookup ausschließlich composite über (tenant_id, token_hash): ein Token
 *    aus Tenant A ist unter Tenant B schlicht unauffindbar (kein Leak-Orakel).
 *  - E-Mails werden vom Aufrufer VOR Store/Vergleich kanonisiert
 *    (canonicalizeEmail) — Basis des Partial-Unique `uq_invitation_pending`.
 */

export type InvitationRole = "content" | "admin";
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

/** Ablauf je Zielrolle (Design §c.4.1: kurz; admin kürzer). Sekunden. */
export const INVITATION_TTL_SEC: Readonly<Record<InvitationRole, number>> = {
  content: 24 * 60 * 60,
  admin: 12 * 60 * 60,
};

export interface InvitationRecord {
  id: string;
  tenantId: string;
  email: string; // kanonisiert
  role: InvitationRole;
  status: InvitationStatus;
  inviterId: string;
  /** Unix-Epoche (Sekunden). */
  expiresAt: number;
  acceptedBy: string | null;
  createdAt: number;
}

export interface NewInvitation {
  id: string;
  tenantId: string;
  email: string; // kanonisiert
  role: InvitationRole;
  /** sha256(rohes Token) als Hex — NIE das Roh-Token. */
  tokenHash: string;
  inviterId: string;
  expiresAt: number;
}

/**
 * Persistenz-Vertrag. Alle Methoden sind tenant-gebunden — es gibt bewusst
 * KEINEN Lookup ohne `tenantId`. Status-Übergänge sind als BEDINGTE Updates
 * modelliert (`WHERE status = 'pending'`) und melden per boolean, ob sie
 * gegriffen haben → single-use/Revoke sind damit race-frei (kein TOCTOU).
 */
export interface InvitationRepository {
  create(invitation: NewInvitation): Promise<void>;
  /** Liste OHNE token_hash (der Hash verlässt die Persistenz nie). */
  listByTenant(tenantId: string): Promise<InvitationRecord[]>;
  findById(tenantId: string, id: string): Promise<InvitationRecord | null>;
  findPendingByEmail(tenantId: string, email: string): Promise<InvitationRecord | null>;
  findByTokenHash(tenantId: string, tokenHash: string): Promise<InvitationRecord | null>;
  /** pending → accepted (+ accepted_by). false = war nicht (mehr) pending. */
  markAccepted(tenantId: string, id: string, acceptedBy: string): Promise<boolean>;
  /** pending → revoked. false = war nicht (mehr) pending. */
  markRevoked(tenantId: string, id: string): Promise<boolean>;
  /** pending → expired (Ablauf beim Accept-Versuch persistieren). */
  markExpired(tenantId: string, id: string): Promise<boolean>;
}

/** 32 Bytes CSPRNG, base64url (43 Zeichen, ohne Padding) — nur für die Mail. */
export function generateInvitationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** sha256(token) als Hex — das EINZIGE, was die DB je sieht. */
export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface InvitationRow {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
  status: string;
  inviter_id: string;
  expires_at: number;
  accepted_by: string | null;
  created_at: number;
}

function mapRow(row: InvitationRow): InvitationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role as InvitationRole,
    status: row.status as InvitationStatus,
    inviterId: row.inviter_id,
    expiresAt: row.expires_at,
    acceptedBy: row.accepted_by,
    createdAt: row.created_at,
  };
}

/** Spalten OHNE token_hash — der Hash wird nie zurückgelesen/gelistet. */
const COLUMNS =
  "id, tenant_id, email, role, status, inviter_id, expires_at, accepted_by, created_at";

/** D1-Implementierung — JEDE Query ist über `tenant_id = ?` gebunden. */
export class D1InvitationRepository implements InvitationRepository {
  constructor(private readonly db: D1Database) {}

  async create(inv: NewInvitation): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO auth_invitation
           (id, tenant_id, email, role, token_hash, inviter_id, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .bind(inv.id, inv.tenantId, inv.email, inv.role, inv.tokenHash, inv.inviterId, inv.expiresAt)
      .run();
  }

  async listByTenant(tenantId: string): Promise<InvitationRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM auth_invitation WHERE tenant_id = ? ORDER BY created_at DESC`,
      )
      .bind(tenantId)
      .all<InvitationRow>();
    return results.map(mapRow);
  }

  async findById(tenantId: string, id: string): Promise<InvitationRecord | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM auth_invitation WHERE tenant_id = ? AND id = ?`)
      .bind(tenantId, id)
      .first<InvitationRow>();
    return row ? mapRow(row) : null;
  }

  async findPendingByEmail(tenantId: string, email: string): Promise<InvitationRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM auth_invitation
          WHERE tenant_id = ? AND email = ? COLLATE NOCASE AND status = 'pending'`,
      )
      .bind(tenantId, email)
      .first<InvitationRow>();
    return row ? mapRow(row) : null;
  }

  async findByTokenHash(tenantId: string, tokenHash: string): Promise<InvitationRecord | null> {
    // AUSSCHLIESSLICH composite (tenant_id, token_hash) — uq_invitation_tenant_token.
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM auth_invitation WHERE tenant_id = ? AND token_hash = ?`)
      .bind(tenantId, tokenHash)
      .first<InvitationRow>();
    return row ? mapRow(row) : null;
  }

  async markAccepted(tenantId: string, id: string, acceptedBy: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE auth_invitation SET status = 'accepted', accepted_by = ?
          WHERE tenant_id = ? AND id = ? AND status = 'pending'`,
      )
      .bind(acceptedBy, tenantId, id)
      .run();
    return res.meta.changes === 1;
  }

  async markRevoked(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE auth_invitation SET status = 'revoked'
          WHERE tenant_id = ? AND id = ? AND status = 'pending'`,
      )
      .bind(tenantId, id)
      .run();
    return res.meta.changes === 1;
  }

  async markExpired(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE auth_invitation SET status = 'expired'
          WHERE tenant_id = ? AND id = ? AND status = 'pending'`,
      )
      .bind(tenantId, id)
      .run();
    return res.meta.changes === 1;
  }
}
