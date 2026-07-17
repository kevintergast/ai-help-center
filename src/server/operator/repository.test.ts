import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  d1FromSqlite,
} from "@/server/auth/sqlite-test-support";
import { D1OperatorRepository, type NewHelpCenter } from "./repository";

/**
 * REAL-DDL-TESTS (Muster: team-persistence.test.ts): das Provisioning-SQL läuft
 * gegen die ECHTEN Migrationen (inkl. tenants.slug UNIQUE, auth_user
 * uq_user_tenant_owner, operator_help_centers PK). Verhinderte reale Fehlerfälle:
 *  - Spalten-/Naming-Drift zwischen Repo-SQL und Migration (liefe in D1 tot),
 *  - partielles Anwenden bei Slug-Kollision (Owner-/Mapping-Waisen),
 *  - versehentlich mehrere Owner je Tenant (uq_user_tenant_owner),
 *  - Cross-Operator-Leak in „meine Hilfezentren".
 */

const MIGRATIONS = [
  "0001_tenants.sql",
  "0002_auth.sql",
  "0003_branding.sql",
  "0004_two_factor_plugin_columns.sql",
  "0005_content.sql", "0018_article_images.sql", "0019_article_translations.sql",
  "0006_operator.sql",
  "0013_seo_indexable.sql",
] as const;

const OP_A = "op_a"; // Operator-Konto A (in t_operator)
const OP_B = "op_b"; // Operator-Konto B (in t_operator)

function makeInput(over: Partial<NewHelpCenter> & { slug: string; tenantId: string }): NewHelpCenter {
  return {
    name: "Acme Support",
    defaultLocale: "de",
    colorPrimary: null,
    colorAccent: null,
    seoIndexable: true,
    operatorUserId: OP_A,
    ownerUserId: `owner_${over.tenantId}`,
    ownerEmail: "operator@example.com",
    ownerName: "Operator",
    ownerCredential: null,
    ...over,
  };
}

describe("D1OperatorRepository gegen die echten Migrationen (D1-Shim über better-sqlite3)", () => {
  let db: Database.Database;
  let d1: D1Database;
  let repo: D1OperatorRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db, MIGRATIONS);
    // Operator-Konten leben in t_operator (aus dem 0006-Seed vorhanden):
    db.prepare(
      "INSERT INTO auth_user (id, tenant_id, email, email_verified, role) VALUES (?, 't_operator', ?, 1, 'user')",
    ).run(OP_A, "operator@example.com");
    db.prepare(
      "INSERT INTO auth_user (id, tenant_id, email, email_verified, role) VALUES (?, 't_operator', ?, 1, 'user')",
    ).run(OP_B, "other-operator@example.com");
    d1 = d1FromSqlite(db);
    repo = new D1OperatorRepository(d1);
  });
  afterEach(() => db.close());

  it("createHelpCenter legt Tenant + GENAU 1 Owner (role=owner, verifiziert, ohne Passwort) im NEUEN Tenant + Mapping an", async () => {
    const input = makeInput({ slug: "acmehelp", tenantId: "t_acme_new", seoIndexable: false });
    expect(await repo.createHelpCenter(input)).toBe("created");

    const tenant = db
      .prepare("SELECT slug, name, plan, seo_indexable FROM tenants WHERE id = ?")
      .get("t_acme_new") as
      | { slug: string; name: string; plan: string; seo_indexable: number }
      | undefined;
    // Wizard-Abfrage (2026-07-16): Opt-out landet direkt am neuen Tenant.
    expect(tenant).toMatchObject({
      slug: "acmehelp",
      name: "Acme Support",
      plan: "free",
      seo_indexable: 0,
    });

    const owners = db
      .prepare("SELECT id, tenant_id, email, email_verified, role FROM auth_user WHERE tenant_id = ?")
      .all("t_acme_new") as { id: string; tenant_id: string; email: string; email_verified: number; role: string }[];
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({
      id: "owner_t_acme_new",
      tenant_id: "t_acme_new",
      email: "operator@example.com",
      email_verified: 1,
      role: "owner",
    });
    // KEIN Passwort/keine credential (Owner setzt es via Reset-Flow):
    const accounts = db.prepare("SELECT id FROM auth_account WHERE user_id = ?").all("owner_t_acme_new");
    expect(accounts).toHaveLength(0);

    // Control-Plane-Mapping (einzige Cross-Tenant-Referenz):
    const mapping = db
      .prepare("SELECT operator_user_id, tenant_id FROM operator_help_centers WHERE tenant_id = ?")
      .get("t_acme_new") as { operator_user_id: string; tenant_id: string } | undefined;
    expect(mapping).toMatchObject({ operator_user_id: OP_A, tenant_id: "t_acme_new" });
  });

  it("Same-Credentials: Kopie legt credential-Account + TOTP-Zeile im NEUEN Tenant an (two_factor_enabled=1)", async () => {
    const input = makeInput({
      slug: "acmehelp",
      tenantId: "t_acme_new",
      ownerCredential: {
        passwordHash: "scrypt$hash$aus$operator",
        socialAccounts: [],
        twoFactor: { secret: "enc-totp-secret", backupCodes: "enc-backup-codes" },
      },
    });
    expect(await repo.createHelpCenter(input)).toBe("created");

    const account = db
      .prepare(
        "SELECT tenant_id, account_id, provider_id, password FROM auth_account WHERE user_id = ?",
      )
      .get("owner_t_acme_new") as Record<string, unknown>;
    expect(account).toMatchObject({
      tenant_id: "t_acme_new",
      account_id: "owner_t_acme_new",
      provider_id: "credential",
      password: "scrypt$hash$aus$operator",
    });

    const twoFactor = db
      .prepare("SELECT tenant_id, secret, backup_codes FROM auth_two_factor WHERE user_id = ?")
      .get("owner_t_acme_new") as Record<string, unknown>;
    expect(twoFactor).toMatchObject({
      tenant_id: "t_acme_new",
      secret: "enc-totp-secret",
      backup_codes: "enc-backup-codes",
    });

    const owner = db
      .prepare("SELECT two_factor_enabled FROM auth_user WHERE id = ?")
      .get("owner_t_acme_new") as { two_factor_enabled: number };
    expect(owner.two_factor_enabled).toBe(1);
  });

  it("getOwnerCredentialTemplate liest Hash+Social+TOTP des Operators; ohne Login-Methode → null", async () => {
    // OP_A: credential + Google-Verknüpfung + TOTP in t_operator.
    db.prepare(
      `INSERT INTO auth_account (id, tenant_id, user_id, account_id, provider_id, password)
       VALUES ('acc_a', 't_operator', ?, ?, 'credential', 'hash-a')`,
    ).run(OP_A, OP_A);
    db.prepare(
      `INSERT INTO auth_account (id, tenant_id, user_id, account_id, provider_id)
       VALUES ('acc_a_g', 't_operator', ?, 'google-sub-1', 'google')`,
    ).run(OP_A);
    db.prepare(
      `INSERT INTO auth_two_factor (id, tenant_id, user_id, secret, backup_codes)
       VALUES ('tf_a', 't_operator', ?, 'sec-a', 'codes-a')`,
    ).run(OP_A);

    expect(await repo.getOwnerCredentialTemplate("t_operator", OP_A)).toEqual({
      passwordHash: "hash-a",
      socialAccounts: [{ providerId: "google", accountId: "google-sub-1" }],
      twoFactor: { secret: "sec-a", backupCodes: "codes-a" },
    });
    // OP_B hat keinerlei Login-Methode → null (Setup-Mail-Fallback).
    expect(await repo.getOwnerCredentialTemplate("t_operator", OP_B)).toBeNull();
  });

  it("SSO-only: Google-Verknüpfung wird als eigener auth_account (ohne Passwort/Tokens) im NEUEN Tenant angelegt", async () => {
    const input = makeInput({
      slug: "ssohelp",
      tenantId: "t_sso_new",
      ownerCredential: {
        passwordHash: null,
        socialAccounts: [{ providerId: "google", accountId: "google-sub-9" }],
        twoFactor: null,
      },
    });
    expect(await repo.createHelpCenter(input)).toBe("created");

    const accounts = db
      .prepare(
        "SELECT tenant_id, provider_id, account_id, password FROM auth_account WHERE user_id = ?",
      )
      .all("owner_t_sso_new") as Record<string, unknown>[];
    // GENAU die Google-Verknüpfung — kein credential-Account ohne Passwort.
    expect(accounts).toEqual([
      {
        tenant_id: "t_sso_new",
        provider_id: "google",
        account_id: "google-sub-9",
        password: null,
      },
    ]);

    const owner = db
      .prepare("SELECT two_factor_enabled FROM auth_user WHERE id = ?")
      .get("owner_t_sso_new") as { two_factor_enabled: number };
    expect(owner.two_factor_enabled).toBe(0);
  });

  it("Owner-Konto ist GETRENNT vom Operator-Konto (andere Zeile, anderer tenant_id) — Isolation gewahrt", async () => {
    await repo.createHelpCenter(makeInput({ slug: "acmehelp", tenantId: "t_acme_new" }));
    const rows = db
      .prepare("SELECT id, tenant_id, role FROM auth_user WHERE email = ? ORDER BY tenant_id")
      .all("operator@example.com") as { id: string; tenant_id: string; role: string }[];
    // Operator-Konto (t_operator, role=user) UND Owner-Konto (t_acme_new, owner):
    expect(rows).toEqual([
      { id: "owner_t_acme_new", tenant_id: "t_acme_new", role: "owner" },
      { id: OP_A, tenant_id: "t_operator", role: "user" },
    ]);
  });

  it("doppelter Slug → 'slug_taken', NICHTS partiell angewendet (keine Owner-/Mapping-Waisen)", async () => {
    expect(await repo.createHelpCenter(makeInput({ slug: "acmehelp", tenantId: "t_first" }))).toBe("created");

    const before = {
      tenants: db.prepare("SELECT COUNT(*) c FROM tenants").get() as { c: number },
      users: db.prepare("SELECT COUNT(*) c FROM auth_user").get() as { c: number },
      map: db.prepare("SELECT COUNT(*) c FROM operator_help_centers").get() as { c: number },
    };

    // Zweiter Create mit demselben Slug (frische Ids) → UNIQUE(tenants.slug):
    expect(await repo.createHelpCenter(makeInput({ slug: "acmehelp", tenantId: "t_second" }))).toBe(
      "slug_taken",
    );

    const after = {
      tenants: db.prepare("SELECT COUNT(*) c FROM tenants").get() as { c: number },
      users: db.prepare("SELECT COUNT(*) c FROM auth_user").get() as { c: number },
      map: db.prepare("SELECT COUNT(*) c FROM operator_help_centers").get() as { c: number },
    };
    expect(after).toEqual(before);
    expect(db.prepare("SELECT id FROM tenants WHERE id = 't_second'").get()).toBeUndefined();
  });

  it("uq_user_tenant_owner (echte DDL): ein zweiter Owner im selben Tenant wirft", async () => {
    await repo.createHelpCenter(makeInput({ slug: "acmehelp", tenantId: "t_acme_new" }));
    expect(() =>
      db
        .prepare(
          "INSERT INTO auth_user (id, tenant_id, email, role) VALUES ('intruder', 't_acme_new', 'x@example.com', 'owner')",
        )
        .run(),
    ).toThrow(/UNIQUE|unique/);
  });

  it("listByOperator zeigt NUR eigene Hilfezentren (Operator B sieht A nicht)", async () => {
    await repo.createHelpCenter(makeInput({ slug: "acmehelp", tenantId: "t_a1", operatorUserId: OP_A }));
    await repo.createHelpCenter(makeInput({ slug: "betahelp", tenantId: "t_a2", operatorUserId: OP_A }));
    await repo.createHelpCenter(makeInput({ slug: "gammahelp", tenantId: "t_b1", operatorUserId: OP_B }));

    const listA = await repo.listByOperator(OP_A);
    expect(listA.map((h) => h.slug).sort()).toEqual(["acmehelp", "betahelp"]);
    expect(listA.map((h) => h.tenantId)).not.toContain("t_b1");

    const listB = await repo.listByOperator(OP_B);
    expect(listB.map((h) => h.slug)).toEqual(["gammahelp"]);
  });

  it("isSlugTaken spiegelt die Kollision (Vor-Check für /subdomain-available)", async () => {
    expect(await repo.isSlugTaken("acmehelp")).toBe(false);
    await repo.createHelpCenter(makeInput({ slug: "acmehelp", tenantId: "t_acme_new" }));
    expect(await repo.isSlugTaken("acmehelp")).toBe(true);
    // Seed-Slugs (0001 'acme', 0006 'app') sind ebenfalls belegt:
    expect(await repo.isSlugTaken("acme")).toBe(true);
    expect(await repo.isSlugTaken("app")).toBe(true);
  });
});
