/**
 * AUDIT-LOG (Phase D, Design §f) — Muster: branding/store.ts.
 *
 * Interface + D1-Implementierung für `auth_audit_log` (migrations/0002_auth.sql):
 * append-only, tenant-scoped. BEWUSST NICHT über den better-auth-Adapter
 * (default-deny für unbekannte Modelle — Absicht), sondern eigene, tenant-
 * gebundene Inserts.
 *
 * METADATA-DISZIPLIN: NIE Tokens/Secrets/Passwörter; keine PII über die
 * ohnehin gespeicherte E-Mail hinaus. Die Aufrufer (Routen) sind dafür
 * verantwortlich — Tests asserten, dass kein Roh-Token im Log landet (D8).
 *
 * FEHLER-SEMANTIK: `append` darf werfen (DB weg etc.); die Routen kapseln das
 * non-blocking (Audit-Ausfall bricht die fachliche Aktion nicht ab), Tests
 * injizieren einen awaitbaren Fake und sehen jeden Eintrag synchron.
 */

export type AuditAction =
  | "invitation.created"
  | "invitation.accepted"
  | "invitation.revoked"
  | "invitation.expired"
  | "ownership.transferred";

export interface AuditEvent {
  tenantId: string;
  /** null = anonym/System. */
  actorId: string | null;
  action: AuditAction;
  targetId?: string | null;
  /** aus `cf-connecting-ip`. */
  ipAddress?: string | null;
  userAgent?: string | null;
  /** JSON-serialisierbar; NIE Tokens/Secrets. */
  metadata?: Record<string, unknown> | null;
}

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
}

/** D1-Implementierung — append-only, tenant_id in jedem Insert. */
export class D1AuditRepository implements AuditRepository {
  constructor(private readonly db: D1Database) {}

  async append(e: AuditEvent): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO auth_audit_log
           (id, tenant_id, actor_id, action, target_id, ip_address, user_agent, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        e.tenantId,
        e.actorId,
        e.action,
        e.targetId ?? null,
        e.ipAddress ?? null,
        e.userAgent ?? null,
        e.metadata ? JSON.stringify(e.metadata) : null,
      )
      .run();
  }
}
