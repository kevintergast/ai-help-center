/**
 * Persistenz des Custom-Domain-Flows auf `tenant_domain` (DDL: 0002) +
 * `tenants.custom_domain`. Muster branding/store.ts: strukturelles Interface,
 * D1-Implementierung mit `tenant_id` in JEDER Query; Tests fahren die echte
 * Migrations-DDL über den sqlite-Shim.
 *
 * MODELL (MVP): EINE Domain pro Tenant. `claim` ersetzt einen bestehenden
 * Anspruch des Tenants (neues Token, Status zurück auf pending) und trägt die
 * Domain parallel in `tenants.custom_domain` ein — AUFGELÖST wird sie erst mit
 * `status='verified'` (Join im Tenant-Resolver, fail-closed, s. repository.ts).
 * Der UNIQUE-Index auf tenant_domain.domain verhindert Doppel-Claims über
 * Tenants hinweg (Domain-Hijack-Schutz auf Schema-Ebene).
 */

export interface DomainClaim {
  domain: string;
  status: "pending" | "verified" | "revoked";
  verificationToken: string;
  verifiedAt: number | null;
  lastCheckedAt: number | null;
}

export type ClaimResult = "claimed" | "domain_taken";

export interface DomainRepository {
  getForTenant(tenantId: string): Promise<DomainClaim | null>;
  /** Domain (neu) beanspruchen: ersetzt den bisherigen Claim DIESES Tenants. */
  claim(tenantId: string, domain: string, token: string, nowSec: number): Promise<ClaimResult>;
  /** Nach erfolgreichem TXT-Check: pending → verified. */
  markVerified(tenantId: string, domain: string, nowSec: number): Promise<boolean>;
  /** Fehlgeschlagenen Check protokollieren (last_checked_at). */
  touchChecked(tenantId: string, domain: string, nowSec: number): Promise<void>;
  /** Claim des Tenants vollständig lösen (Row + tenants.custom_domain). */
  release(tenantId: string): Promise<void>;
}

export class D1DomainRepository implements DomainRepository {
  constructor(private readonly db: D1Database) {}

  async getForTenant(tenantId: string): Promise<DomainClaim | null> {
    const row = await this.db
      .prepare(
        `SELECT domain, status, verification_token, verified_at, last_checked_at
           FROM tenant_domain WHERE tenant_id = ?`,
      )
      .bind(tenantId)
      .first<{
        domain: string;
        status: DomainClaim["status"];
        verification_token: string;
        verified_at: number | null;
        last_checked_at: number | null;
      }>();
    if (!row) return null;
    return {
      domain: row.domain,
      status: row.status,
      verificationToken: row.verification_token,
      verifiedAt: row.verified_at,
      lastCheckedAt: row.last_checked_at,
    };
  }

  async claim(
    tenantId: string,
    domain: string,
    token: string,
    nowSec: number,
  ): Promise<ClaimResult> {
    // Vor-Check für einen präzisen 409; autoritativ bleibt der UNIQUE-Index
    // im batch() (TOCTOU-Race → Constraint-Fehler → domain_taken).
    const taken = await this.db
      .prepare(`SELECT 1 AS hit FROM tenant_domain WHERE domain = ? AND tenant_id != ?`)
      .bind(domain, tenantId)
      .first<{ hit: number }>();
    if (taken) return "domain_taken";

    try {
      await this.db.batch([
        this.db.prepare(`DELETE FROM tenant_domain WHERE tenant_id = ?`).bind(tenantId),
        this.db
          .prepare(
            `INSERT INTO tenant_domain (id, tenant_id, domain, verification_token, status, created_at)
             VALUES (?, ?, ?, ?, 'pending', ?)`,
          )
          .bind(crypto.randomUUID(), tenantId, domain, token, nowSec),
        this.db.prepare(`UPDATE tenants SET custom_domain = ? WHERE id = ?`).bind(domain, tenantId),
      ]);
      return "claimed";
    } catch {
      return "domain_taken";
    }
  }

  async markVerified(tenantId: string, domain: string, nowSec: number): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE tenant_domain
            SET status = 'verified', verified_at = ?, last_checked_at = ?
          WHERE tenant_id = ? AND domain = ? AND status != 'revoked'`,
      )
      .bind(nowSec, nowSec, tenantId, domain)
      .run();
    return res.meta.changes > 0;
  }

  async touchChecked(tenantId: string, domain: string, nowSec: number): Promise<void> {
    await this.db
      .prepare(`UPDATE tenant_domain SET last_checked_at = ? WHERE tenant_id = ? AND domain = ?`)
      .bind(nowSec, tenantId, domain)
      .run();
  }

  async release(tenantId: string): Promise<void> {
    await this.db.batch([
      this.db.prepare(`DELETE FROM tenant_domain WHERE tenant_id = ?`).bind(tenantId),
      this.db.prepare(`UPDATE tenants SET custom_domain = NULL WHERE id = ?`).bind(tenantId),
    ]);
  }
}
