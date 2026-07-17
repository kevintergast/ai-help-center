import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { getAuthTables } from "better-auth/db";
import { getAdapter } from "better-auth/db/adapter";
import { describe, expect, it } from "vitest";
import { buildAuth, tenantAuthOptions } from "./auth";
import { runWithTenant } from "./tenant-context";

/**
 * SCHEMA-PARITÄT Code ↔ D1-Migrationen (Regressionswächter).
 *
 * Verhinderter realer Fehlerfall: better-auths Default-Naming ist
 * `user`/`twoFactor` mit camelCase-Spalten; die Migrationen legen
 * `auth_*`-Tabellen mit snake_case an. Ohne die `modelName`/`fieldName`-
 * Mappings in `tenantAuthOptions` (bzw. im tenantTwoFactorSchemaPlugin) wäre
 * JEDE Auth-Operation auf echter D1 tot ("no such table: user") — und kein
 * Unit-Test würde es merken, weil Memory-/SQLite-Fixtures das jeweils
 * konfigurierte Schema spiegeln. Dieser Test parst deshalb die Migrationen
 * und assertet: jedes better-auth-Modell mappt auf eine existierende Tabelle
 * und jedes Feld auf eine existierende Spalte.
 */

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";

/** Parst CREATE TABLE/ALTER TABLE ADD COLUMN aus den forward-only-Migrationen. */
function parseMigrationColumns(files: string[]): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const sql = files
    .map((f) => readFileSync(join(process.cwd(), "migrations", f), "utf8"))
    .join("\n");

  // CREATE TABLE <name> ( ... );  — Spalten = Zeilen der Form "<name> TEXT|INTEGER ...".
  const createRe = /CREATE TABLE (\w+)\s*\(([\s\S]*?)\n\);/g;
  for (const m of sql.matchAll(createRe)) {
    const [, table, body] = m;
    const cols = new Set<string>();
    for (const line of body.split("\n")) {
      const col = line.match(/^\s*([a-z_]+)\s+(?:TEXT|INTEGER)\b/);
      if (col) cols.add(col[1]);
    }
    tables.set(table, cols);
  }

  // ALTER TABLE <name> ADD COLUMN <col> ...
  const alterRe = /ALTER TABLE (\w+) ADD COLUMN (\w+)/g;
  for (const m of sql.matchAll(alterRe)) {
    const [, table, col] = m;
    tables.get(table)?.add(col);
  }
  return tables;
}

describe("Schema-Parität: getAuthTables(tenantAuthOptions) ↔ migrations/", () => {
  const migrations = parseMigrationColumns(["0002_auth.sql", "0004_two_factor_plugin_columns.sql"]);
  const authTables = getAuthTables(tenantAuthOptions(TEST_SECRET));

  it("Schärfe-Kontrolle: der Migrations-Parser findet die auth_*-Tabellen", () => {
    expect([...migrations.keys()]).toEqual(
      expect.arrayContaining([
        "auth_user",
        "auth_session",
        "auth_account",
        "auth_verification",
        "auth_two_factor",
      ]),
    );
    // Stichproben inkl. 0004-ALTERs — beweist, dass der Parser Spalten sieht.
    expect(migrations.get("auth_user")).toContain("pending_role");
    expect(migrations.get("auth_two_factor")).toContain("failed_verification_count");
  });

  it("jedes better-auth-Modell mappt auf eine in den Migrationen angelegte Tabelle", () => {
    const models = Object.keys(authTables);
    // Schärfe: die Kern-Modelle + twoFactor sind wirklich Teil des Schemas.
    expect(models).toEqual(
      expect.arrayContaining(["user", "session", "account", "verification", "twoFactor"]),
    );
    for (const model of models) {
      const tableName = authTables[model].modelName;
      expect(
        migrations.has(tableName),
        `Modell "${model}" mappt auf "${tableName}" — Tabelle fehlt in den Migrationen ` +
          `(Default-Naming-Drift? modelName-Mapping in auth.ts/mfa-policy.ts prüfen)`,
      ).toBe(true);
    }
  });

  it("jedes better-auth-Feld mappt auf eine existierende Spalte (fieldName-Parität)", () => {
    for (const [model, def] of Object.entries(authTables)) {
      const cols = migrations.get(def.modelName);
      if (!cols) continue; // bereits vom Tabellen-Test gemeldet
      expect(cols, `Tabelle ${def.modelName}: Primärschlüssel id`).toContain("id");
      for (const [field, attr] of Object.entries(def.fields)) {
        const column = attr.fieldName || field;
        expect(
          cols.has(column),
          `${model}.${field} mappt auf ${def.modelName}.${column} — Spalte fehlt in den ` +
            `Migrationen (fieldName-Mapping oder additive Migration nötig)`,
        ).toBe(true);
      }
    }
  });

  // Empirischer Beweis über Namen hinaus: der gemappte Adapter muss gegen die
  // ECHTE Migrations-DDL (inkl. NOT NULL/CHECK/UNIQUE/Defaults) schreiben
  // können — fängt Constraint-/Typ-Inkompatibilitäten, die reine Namens-
  // Parität nicht sieht (z. B. ein NOT-NULL-Feld, das der Adapter nie setzt).
  it("signUp gegen die echten migrations/*.sql funktioniert und schreibt tenant_id", async () => {
    const db = new Database(":memory:");
    for (const f of ["0001_tenants.sql", "0021_tenant_suspend.sql", "0002_auth.sql", "0004_two_factor_plugin_columns.sql"]) {
      db.exec(readFileSync(join(process.cwd(), "migrations", f), "utf8"));
    }
    db.prepare("INSERT INTO tenants (id, slug, name) VALUES ('t_real', 'real', 'Real')").run();

    const inner = await getAdapter({ ...tenantAuthOptions(TEST_SECRET), database: db });
    const auth = buildAuth({ adapter: inner, secret: TEST_SECRET });

    const res = await runWithTenant("t_real", () =>
      auth.api.signUpEmail({
        body: { email: "real@example.com", password: "correct-horse-battery", name: "Real" },
        headers: new Headers(),
      }),
    );
    expect(res.user).toBeTruthy();

    const row = db
      .prepare("SELECT tenant_id, email, role, two_factor_enabled FROM auth_user WHERE email = ?")
      .get("real@example.com") as Record<string, unknown>;
    expect(row.tenant_id).toBe("t_real");
    expect(row.role).toBe("user");
    expect(row.two_factor_enabled).toBe(0);
    db.close();
  });
});
