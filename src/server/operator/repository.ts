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
  /** Suchmaschinen-Indexierung (Wizard-Abfrage, Migration 0013). */
  seoIndexable: boolean;
  /** Operator-Konto (auth_user.id in t_operator), das provisioniert. */
  operatorUserId: string;
  /** Owner-Konto, das IM NEUEN Tenant angelegt wird. */
  ownerUserId: string;
  /** Kanonisierte Owner-E-Mail (= Operator-E-Mail). */
  ownerEmail: string;
  /** Anzeigename des Owner-Kontos (aus dem Operator-Konto abgeleitet). */
  ownerName: string | null;
  /**
   * SAME-CREDENTIALS-KOMFORT (Entscheidung 2026-07-16, erweitert um Social):
   * EINMALIGE Kopie der Operator-Anmeldemethoden ins neue Owner-Konto —
   *  - Passwort-Hash (scrypt, key-unabhängig portabel),
   *  - Social-VERKNÜPFUNGEN (nur providerId+accountId, KEINE Tokens: jeder
   *    Login bleibt ein frischer OAuth-Roundtrip übers Gateway; better-auth
   *    hinterlegt Tokens beim ersten Sign-in selbst),
   *  - TOTP-Zeile (Ciphertext portabel, da better-auth global mit AUTH_SECRET
   *    verschlüsselt) — unabhängig von der Login-Methode.
   * Danach völlig unabhängige Konten (Änderungen gelten PRO Instanz);
   * Sessions/Cookies bleiben strikt instanz-isoliert — es gibt weiterhin KEIN
   * Cross-Instance-SSO (nur gleiche AnmeldeMETHODEN, getrennte Logins).
   * `null` = keine kopierbare Anmeldemethode → Setup-Mail-Fallback.
   */
  ownerCredential: {
    passwordHash: string | null;
    socialAccounts: { providerId: string; accountId: string }[];
    twoFactor: { secret: string; backupCodes: string } | null;
  } | null;
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
  /** Anzahl provisionierter Hilfezentren (Abuse-Cap pro Konto, api/operator.ts). */
  countByOperator(operatorUserId: string): Promise<number>;
  /**
   * Zugangsdaten-Vorlage des OPERATOR-Kontos (credential-Passwort-Hash + ggf.
   * TOTP-Zeile) für die Same-Credentials-Kopie. Control-Plane-Lesezugriff auf
   * t_operator — ausschließlich vom Provisioning genutzt, nie request-getrieben
   * cross-tenant. `null` = kein Passwort-Credential (Social-only).
   */
  getOwnerCredentialTemplate(
    tenantId: string,
    userId: string,
  ): Promise<NewHelpCenter["ownerCredential"]>;
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

  async countByOperator(operatorUserId: string): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM operator_help_centers WHERE operator_user_id = ?`)
      .bind(operatorUserId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async createHelpCenter(input: NewHelpCenter): Promise<CreateResult> {
    // (a) NEUER Kunden-Tenant. Slug ist UNIQUE — kollidiert er, wirft der Insert
    //     und die batch()-Transaktion rollt (b)+(c) mit zurück.
    const insertTenant = this.db
      .prepare(
        `INSERT INTO tenants (id, slug, name, default_locale, color_primary, color_accent, plan, seo_indexable)
         VALUES (?, ?, ?, ?, COALESCE(?, '#4f46e5'), COALESCE(?, '#06b6d4'), 'free', ?)`,
      )
      .bind(
        input.tenantId,
        input.slug,
        input.name,
        input.defaultLocale,
        input.colorPrimary,
        input.colorAccent,
        input.seoIndexable ? 1 : 0,
      );

    // (b) OWNER-KONTO IM NEUEN TENANT — role='owner', email_verified=1 (aus der
    //     Operator-Verifikation abgeleitet). Mit `ownerCredential` startet das
    //     Konto mit den KOPIERTEN Operator-Zugangsdaten (Same-Credentials-
    //     Komfort, s. NewHelpCenter) inkl. two_factor_enabled-Spiegelung; ohne
    //     bleibt es passwortlos (Setup-Mail-Flow). Der Partial-Unique
    //     uq_user_tenant_owner erzwingt genau 1 Owner/Tenant.
    const twoFactorEnabled = input.ownerCredential?.twoFactor ? 1 : 0;
    const insertOwner = this.db
      .prepare(
        `INSERT INTO auth_user (id, tenant_id, name, email, email_verified, role, two_factor_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'owner', ?, unixepoch(), unixepoch())`,
      )
      .bind(input.ownerUserId, input.tenantId, input.ownerName, input.ownerEmail, twoFactorEnabled);

    // (c) CONTROL-PLANE-MAPPING (einzige erlaubte Cross-Tenant-Referenz).
    const insertMapping = this.db
      .prepare(
        `INSERT INTO operator_help_centers (operator_user_id, tenant_id) VALUES (?, ?)`,
      )
      .bind(input.operatorUserId, input.tenantId);

    const statements = [insertTenant, insertOwner, insertMapping];

    // (d) SAME-CREDENTIALS-KOPIE (optional), strikt im NEUEN Tenant — einmalige
    //     Kopie, danach unabhängig:
    //     - credential-Account (Passwort-Hash, account_id = user_id nach
    //       better-auth-Konvention),
    //     - Social-Verknüpfungen (providerId + accountId, Tokens NULL — werden
    //       beim ersten echten Login vom Provider frisch hinterlegt),
    //     - TOTP-Zeile (unabhängig von der Login-Methode).
    if (input.ownerCredential) {
      if (input.ownerCredential.passwordHash !== null) {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO auth_account (id, tenant_id, user_id, account_id, provider_id, password, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'credential', ?, unixepoch(), unixepoch())`,
            )
            .bind(
              crypto.randomUUID(),
              input.tenantId,
              input.ownerUserId,
              input.ownerUserId,
              input.ownerCredential.passwordHash,
            ),
        );
      }
      for (const social of input.ownerCredential.socialAccounts) {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO auth_account (id, tenant_id, user_id, account_id, provider_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
            )
            .bind(
              crypto.randomUUID(),
              input.tenantId,
              input.ownerUserId,
              social.accountId,
              social.providerId,
            ),
        );
      }
      if (input.ownerCredential.twoFactor) {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO auth_two_factor (id, tenant_id, user_id, secret, backup_codes, created_at)
               VALUES (?, ?, ?, ?, ?, unixepoch())`,
            )
            .bind(
              crypto.randomUUID(),
              input.tenantId,
              input.ownerUserId,
              input.ownerCredential.twoFactor.secret,
              input.ownerCredential.twoFactor.backupCodes,
            ),
        );
      }
    }

    try {
      await this.db.batch(statements);
      return "created";
    } catch (err) {
      // Einzige plausible UNIQUE-Kollision bei frischen Ids ist tenants.slug →
      // 409 slug_taken. Alles andere ist ein echter Fehler (rethrow → 500).
      if (err instanceof Error && /unique/i.test(err.message)) return "slug_taken";
      throw err;
    }
  }

  async getOwnerCredentialTemplate(
    tenantId: string,
    userId: string,
  ): Promise<NewHelpCenter["ownerCredential"]> {
    // ALLE Anmeldemethoden des Operator-Kontos: credential (mit Passwort) +
    // Social-Verknüpfungen (google/microsoft/… = alles außer 'credential').
    const accounts = await this.db
      .prepare(
        `SELECT provider_id, account_id, password FROM auth_account
          WHERE tenant_id = ? AND user_id = ?`,
      )
      .bind(tenantId, userId)
      .all<{ provider_id: string; account_id: string; password: string | null }>();

    const credential = accounts.results.find(
      (a) => a.provider_id === "credential" && a.password !== null,
    );
    const socialAccounts = accounts.results
      .filter((a) => a.provider_id !== "credential")
      .map((a) => ({ providerId: a.provider_id, accountId: a.account_id }));

    // Ohne kopierbare LOGIN-Methode → Setup-Mail-Fallback (TOTP allein
    // ermöglicht keinen Login).
    if (!credential && socialAccounts.length === 0) return null;

    const twoFactor = await this.db
      .prepare(
        `SELECT secret, backup_codes FROM auth_two_factor
          WHERE tenant_id = ? AND user_id = ?`,
      )
      .bind(tenantId, userId)
      .first<{ secret: string; backup_codes: string }>();

    return {
      passwordHash: credential?.password ?? null,
      socialAccounts,
      twoFactor: twoFactor
        ? { secret: twoFactor.secret, backupCodes: twoFactor.backup_codes }
        : null,
    };
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
