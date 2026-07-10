/**
 * TEAM-USER-PERSISTENZ (Phase D): Rollen-Reads + Ownership-Transfer + Revoke.
 *
 * Muster wie branding/store.ts (Interface + D1-Impl + Map-Fake in Tests).
 * BEWUSST direkt auf `auth_user`/`auth_session` (nicht über den better-auth-
 * Adapter): der Transfer braucht D1-`batch()`-Atomarität mit BEDINGTEN
 * Updates — das kann der Adapter nicht ausdrücken.
 *
 * OWNERSHIP-TRANSFER (Design §c.6, TOCTOU-sicher, P-5):
 * D1 kennt keine interaktiven Transaktionen, aber `batch()` ist transaktional.
 * Ein „affected-rows prüfen und dann zurückrollen" gibt es in D1 nicht —
 * deshalb sind die Statements so KREUZ-KONDITIONIERT, dass ein PARTIELLES
 * Anwenden unmöglich ist (jede Bedingung steht im WHERE, nichts wird vorab
 * gelesen):
 *
 *   (1) DEMOTE  actor: owner→admin — NUR wenn der actor (noch) owner ist UND
 *       das Ziel im selben Tenant transferierbar ist (role∈{admin,content},
 *       two_factor_enabled=1, banned=0 — ein gebanntes Konto darf NIE owner
 *       werden). Greift (1) nicht, ist der Tenant unverändert.
 *   (2) PROMOTE target: →owner — NUR wenn das Ziel (immer noch) transferierbar
 *       ist UND der Tenant in diesem Moment KEINEN owner hat (= (1) hat gerade
 *       gegriffen) UND der actor jetzt admin ist. Innerhalb der batch()-
 *       Transaktion kann sich zwischen (1) und (2) nichts ändern → (1) greift
 *       ⇔ (2) greift. `pending_role` wird beim Promote genullt.
 *
 * REIHENFOLGE ist tragend: erst demote, dann promote — sonst verletzte der
 * Promote den Partial-Unique `uq_user_tenant_owner` (genau 1 owner/Tenant).
 * Der Index bleibt als letzte Verteidigung: ein konstruierter Doppel-Owner
 * wirft, und `batch()` rollt die GESAMTE Transaktion zurück (Real-DDL-Test).
 *
 * Ergebnis-Semantik: true ⇔ BEIDE Statements haben genau 1 Zeile geändert.
 * Alles andere (Ziel-MFA zwischenzeitlich deaktiviert, Doppel-Transfer-Race,
 * Rollenwechsel) ⇒ false, DB nachweislich unverändert ⇒ Route antwortet
 * 409 transfer_conflict.
 */

import type { Role } from "./access-control";

export interface TeamUserRow {
  id: string;
  email: string;
  role: Role | string;
  pendingRole: string | null;
  twoFactorEnabled: boolean;
  banned: boolean;
}

export interface TeamUserRepository {
  findById(tenantId: string, userId: string): Promise<TeamUserRow | null>;
  /** Atomarer Owner-Wechsel (siehe Kopfkommentar). true = vollständig vollzogen. */
  transferOwnership(tenantId: string, actorId: string, targetId: string): Promise<boolean>;
  /** ALLE Sessions des Users im Tenant widerrufen (§e: Transfer revoked beide). */
  revokeSessions(tenantId: string, userId: string): Promise<void>;
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  pending_role: string | null;
  two_factor_enabled: number;
  banned: number;
}

export class D1TeamUserRepository implements TeamUserRepository {
  constructor(private readonly db: D1Database) {}

  async findById(tenantId: string, userId: string): Promise<TeamUserRow | null> {
    const row = await this.db
      .prepare(
        `SELECT id, email, role, pending_role, two_factor_enabled, banned
           FROM auth_user WHERE tenant_id = ? AND id = ?`,
      )
      .bind(tenantId, userId)
      .first<UserRow>();
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      pendingRole: row.pending_role,
      twoFactorEnabled: row.two_factor_enabled === 1,
      banned: row.banned === 1,
    };
  }

  async transferOwnership(tenantId: string, actorId: string, targetId: string): Promise<boolean> {
    // (1) DEMOTE — bind: actorId, tenantId, targetId, tenantId
    const demote = this.db
      .prepare(
        `UPDATE auth_user SET role = 'admin', updated_at = unixepoch()
          WHERE id = ? AND tenant_id = ? AND role = 'owner'
            AND EXISTS (SELECT 1 FROM auth_user
                         WHERE id = ? AND tenant_id = ?
                           AND role IN ('admin','content')
                           AND two_factor_enabled = 1 AND banned = 0)`,
      )
      .bind(actorId, tenantId, targetId, tenantId);

    // (2) PROMOTE — bind: targetId, tenantId, tenantId, actorId, tenantId
    const promote = this.db
      .prepare(
        `UPDATE auth_user SET role = 'owner', pending_role = NULL, updated_at = unixepoch()
          WHERE id = ? AND tenant_id = ?
            AND role IN ('admin','content') AND two_factor_enabled = 1 AND banned = 0
            AND NOT EXISTS (SELECT 1 FROM auth_user WHERE tenant_id = ? AND role = 'owner')
            AND EXISTS (SELECT 1 FROM auth_user
                         WHERE id = ? AND tenant_id = ? AND role = 'admin')`,
      )
      .bind(targetId, tenantId, tenantId, actorId, tenantId);

    const [d, p] = await this.db.batch([demote, promote]);
    return d.meta.changes === 1 && p.meta.changes === 1;
  }

  async revokeSessions(tenantId: string, userId: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM auth_session WHERE tenant_id = ? AND user_id = ?`)
      .bind(tenantId, userId)
      .run();
  }
}
