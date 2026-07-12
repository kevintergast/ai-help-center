/**
 * OPERATOR-PROVISIONING-PERSISTENZ (Punkt 4b) — Muster: team-users.ts
 * (Interface + D1-Impl mit kreuz-konditioniertem `batch()`, Map-/Real-DDL-Fakes
 * in Tests).
 *
 * BEWUSST direkt auf `tenants`/`auth_user`/`operator_help_centers` (nicht über
 * den better-auth-Adapter): das Provisioning legt einen NEUEN Tenant + dessen
 * Owner-Konto + das Control-Plane-Mapping in EINER transaktionalen `batch()`-
 * Operation an. Das kann der (tenant-gescopete, single-model) Adapter nicht
 * ausdrücken.
 *
 * ISOLATION / KONTROLLIERTE CROSS-TENANT-REFERENZ:
 *  - Das Owner-Konto entsteht IM NEUEN Tenant (eigene auth_user-Zeile,
 *    `tenant_id = <neuer Tenant>`, `role='owner'`, `email_verified=1`, KEIN
 *    Passwort/keine credential). Es ist strikt getrennt vom Operator-Konto
 *    (das in `t_operator` lebt) — gleiche E-Mail, getrennte Konten.
 *  - `operator_help_centers` ist die EINZIGE erlaubte Cross-Tenant-Referenz und
 *    wird ausschließlich operator-scoped gelesen (`listByOperator`) — ein
 *    Operator sieht NUR eigene Hilfezentren.
 *  - `uq_user_tenant_owner` (genau 1 Owner/Tenant) bleibt die letzte
 *    Verteidigung: ein zweiter Owner-Insert im selben Tenant wirft und rollt die
 *    GESAMTE batch()-Transaktion zurück.
 */

import type { NewLocale } from "./validate";

/** Voll aufgelöste Provisioning-Eingabe (nach Validierung + Id-Vergabe). */
export interface NewHelpCenter {
  /** Neuer Tenant (crypto.randomUUID-basierte Id, z. B. `t_<uuid>`). */
  tenantId: string;
  slug: string;
  name: string;
  defaultLocale: NewLocale;
  /** Branding-Farben (bereits validierte Hex-Werte) oder `null` → DB-Default. */
  colorPrimary: string | null;
  colorAccent: string | null;
  /** Operator-Konto (auth_user.id in t_operator), das provisioniert. */
  operatorUserId: string;
  /** Owner-Konto, das IM NEUEN Tenant angelegt wird. */
  ownerUserId: string;
  /** Kanonisierte Owner-E-Mail (= Operator-E-Mail). */
  ownerEmail: string;
  /** Anzeigename des Owner-Kontos (aus dem Operator-Konto abgeleitet). */
  ownerName: string | null;
}

/** Ergebnis von `createHelpCenter`. */
export type CreateResult = "created" | "slug_taken";

/** Ein vom Operator provisioniertes Hilfezentrum (Listen-Projektion). */
export interface HelpCenterSummary {
  tenantId: string;
  slug: string;
  name: string;
  defaultLocale: string;
  createdAt: number;
}

export interface OperatorRepository {
  /** Ist der Slug bereits als Tenant vergeben? (Vor-Check für /subdomain-available.) */
  isSlugTaken(slug: string): Promise<boolean>;
  /**
   * Legt Tenant + Owner-Konto (im neuen Tenant) + Operator-Mapping transaktional
   * an. `slug_taken`, wenn der Slug beim finalen Insert kollidiert (UNIQUE) —
   * autoritativ, kein TOCTOU zum Vor-Check.
   */
  createHelpCenter(input: NewHelpCenter): Promise<CreateResult>;
  /** Alle vom Operator-Konto provisionierten Hilfezentren (nur eigene). */
  listByOperator(operatorUserId: string): Promise<HelpCenterSummary[]>;
}

interface TenantSlugRow {
  id: string;
}

interface HelpCenterRow {
  tenant_id: string;
  slug: string;
  name: string;
  default_locale: string;
  created_at: number;
}

/** D1-Implementierung. */
export class D1OperatorRepository implements OperatorRepository {
  constructor(private readonly db: D1Database) {}

  async isSlugTaken(slug: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT id FROM tenants WHERE slug = ?`)
      .bind(slug)
      .first<TenantSlugRow>();
    return row !== null;
  }

  async createHelpCenter(input: NewHelpCenter): Promise<CreateResult> {
    // (a) NEUER Kunden-Tenant. Slug ist UNIQUE — kollidiert er, wirft der Insert
    //     und die batch()-Transaktion rollt (b)+(c) mit zurück.
    const insertTenant = this.db
      .prepare(
        `INSERT INTO tenants (id, slug, name, default_locale, color_primary, color_accent, plan)
         VALUES (?, ?, ?, ?, COALESCE(?, '#4f46e5'), COALESCE(?, '#06b6d4'), 'free')`,
      )
      .bind(
        input.tenantId,
        input.slug,
        input.name,
        input.defaultLocale,
        input.colorPrimary,
        input.colorAccent,
      );

    // (b) OWNER-KONTO IM NEUEN TENANT — role='owner', email_verified=1 (aus der
    //     Operator-Verifikation abgeleitet), KEIN Passwort (keine credential;
    //     Owner setzt es via Reset-Flow auf <slug>.hallofhelp.app). Der
    //     Partial-Unique uq_user_tenant_owner erzwingt genau 1 Owner/Tenant.
    const insertOwner = this.db
      .prepare(
        `INSERT INTO auth_user (id, tenant_id, name, email, email_verified, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'owner', unixepoch(), unixepoch())`,
      )
      .bind(input.ownerUserId, input.tenantId, input.ownerName, input.ownerEmail);

    // (c) CONTROL-PLANE-MAPPING (einzige erlaubte Cross-Tenant-Referenz).
    const insertMapping = this.db
      .prepare(
        `INSERT INTO operator_help_centers (operator_user_id, tenant_id) VALUES (?, ?)`,
      )
      .bind(input.operatorUserId, input.tenantId);

    try {
      await this.db.batch([insertTenant, insertOwner, insertMapping]);
      return "created";
    } catch (err) {
      // Einzige plausible UNIQUE-Kollision bei frischen Ids ist tenants.slug →
      // 409 slug_taken. Alles andere ist ein echter Fehler (rethrow → 500).
      if (err instanceof Error && /unique/i.test(err.message)) return "slug_taken";
      throw err;
    }
  }

  async listByOperator(operatorUserId: string): Promise<HelpCenterSummary[]> {
    const { results } = await this.db
      .prepare(
        `SELECT t.id AS tenant_id, t.slug, t.name, t.default_locale, m.created_at
           FROM operator_help_centers m
           JOIN tenants t ON t.id = m.tenant_id
          WHERE m.operator_user_id = ?
          ORDER BY m.created_at DESC`,
      )
      .bind(operatorUserId)
      .all<HelpCenterRow>();
    return results.map((r) => ({
      tenantId: r.tenant_id,
      slug: r.slug,
      name: r.name,
      defaultLocale: r.default_locale,
      createdAt: r.created_at,
    }));
  }
}
