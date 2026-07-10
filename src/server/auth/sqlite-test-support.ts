import { readFileSync } from "node:fs";
import { join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";

/**
 * TEST-ONLY: legt in einer in-memory SQLite-DB genau die Tabellen an, die
 * better-auths Kysely-Adapter aus `tenantAuthOptions` erwartet — mit dem
 * PRODUKTIONS-Naming aus den D1-Migrationen (auth_*-Tabellen, snake_case-
 * Spalten; siehe `migrations/0002_auth.sql` + `0004_two_factor_plugin_columns.sql`
 * und die `modelName`/`fieldName`-Mappings in `auth.ts`/`mfa-policy.ts`).
 * Die Namens-Parität Code↔Migration wird zusätzlich von
 * `schema-parity.test.ts` erzwungen. Bewusst KEINE NOT-NULL/CHECK-Constraints —
 * der Fokus dieser Tests ist die WHERE→SQL-Isolationssemantik, nicht die
 * DB-Härtung (die in den Migrationen liegt).
 *
 * Diese Datei wird ausschließlich von Tests importiert; sie ist NICHT Teil des
 * Worker-Bundles (`better-sqlite3` ist eine devDependency).
 */
/** Spielt die ECHTEN forward-only-Migrationen in eine SQLite-DB ein. */
export function applyMigrations(db: BetterSqlite3.Database, files: readonly string[]): void {
  for (const f of files) {
    db.exec(readFileSync(join(process.cwd(), "migrations", f), "utf8"));
  }
}

/**
 * TEST-ONLY: minimaler `D1Database`-Shim über better-sqlite3, für Repositories,
 * die handgeschriebenes SQL gegen die ECHTE Migrations-DDL fahren
 * (`prepare().bind().first()/all()/run()` + `batch()`).
 *
 * `batch()` läuft — wie in D1 dokumentiert — als EINE Transaktion: wirft ein
 * Statement (z. B. ein UNIQUE-Index), wird ALLES zurückgerollt. Die
 * Rollback-Semantik hier ist die von better-sqlite3, nicht der Beweis für D1 —
 * die Tests stützen sich deshalb primär auf die WHERE-Kreuz-Konditionierung
 * (Ergebnis `meta.changes`) und die DDL-Constraints selbst.
 */
export function d1FromSqlite(db: BetterSqlite3.Database): D1Database {
  interface ShimStatement {
    sql: string;
    params: unknown[];
    bind(...args: unknown[]): ShimStatement;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta: { changes: number } }>;
  }

  type BindParams = Parameters<BetterSqlite3.Statement["run"]>;

  const makeStatement = (sql: string, params: unknown[]): ShimStatement => ({
    sql,
    params,
    bind: (...args: unknown[]) => makeStatement(sql, args),
    first: async <T>() =>
      ((db.prepare(sql).get(...(params as BindParams)) as T | undefined) ?? null),
    all: async <T>() => ({ results: db.prepare(sql).all(...(params as BindParams)) as T[] }),
    run: async () => ({
      meta: { changes: db.prepare(sql).run(...(params as BindParams)).changes },
    }),
  });

  return {
    prepare: (sql: string) => makeStatement(sql, []),
    batch: async (statements: ShimStatement[]) => {
      const tx = db.transaction(() =>
        statements.map((s) => ({
          meta: { changes: db.prepare(s.sql).run(...(s.params as BindParams)).changes },
        })),
      );
      return tx();
    },
  } as unknown as D1Database;
}

export function createSqliteAuthSchema(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE auth_user (
      id                 TEXT PRIMARY KEY,
      tenant_id          TEXT,
      name               TEXT,
      email              TEXT,
      email_verified     INTEGER,
      image              TEXT,
      role               TEXT,
      pending_role       TEXT,
      two_factor_enabled INTEGER,
      created_at         TEXT,
      updated_at         TEXT
    );
    CREATE TABLE auth_session (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT,
      user_id         TEXT,
      token           TEXT,
      mfa_verified    INTEGER,
      mfa_verified_at INTEGER,
      ip_address      TEXT,
      user_agent      TEXT,
      expires_at      TEXT,
      created_at      TEXT,
      updated_at      TEXT
    );
    CREATE TABLE auth_two_factor (
      id                        TEXT PRIMARY KEY,
      tenant_id                 TEXT,
      user_id                   TEXT,
      secret                    TEXT,
      backup_codes              TEXT,
      verified                  INTEGER,
      failed_verification_count INTEGER,
      locked_until              TEXT,
      created_at                TEXT
    );
    CREATE TABLE auth_account (
      id                       TEXT PRIMARY KEY,
      tenant_id                TEXT,
      user_id                  TEXT,
      account_id               TEXT,
      provider_id              TEXT,
      access_token             TEXT,
      refresh_token            TEXT,
      id_token                 TEXT,
      access_token_expires_at  TEXT,
      refresh_token_expires_at TEXT,
      scope                    TEXT,
      password                 TEXT,
      created_at               TEXT,
      updated_at               TEXT
    );
    CREATE TABLE auth_verification (
      id         TEXT PRIMARY KEY,
      tenant_id  TEXT,
      identifier TEXT,
      value      TEXT,
      expires_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
}
