import type { DBAdapter, DBTransactionAdapter, Where } from "better-auth";
import { currentTenantIdOrThrow } from "./tenant-context";

/**
 * Der ISOLATIONS-KERN: ein Wrapper um better-auths `DBAdapter`, der JEDE
 * tenant-gebundene DB-Operation an den aktuellen Tenant-Kontext koppelt.
 *
 * Sicherheitsmodell (fail-closed + default-deny):
 *  - create/insert: `tenantId` wird aus `currentTenantIdOrThrow()` in die Daten
 *    injiziert. Ohne Kontext wirft es -> kein ungescopeter Insert möglich.
 *  - findOne/findMany/update/updateMany/delete/deleteMany/count/consumeOne/
 *    incrementOne: eine zusätzliche
 *    Bedingung `tenantId == currentTenantIdOrThrow()` wird an die `where`-Klausel
 *    ANGEHÄNGT (Connector "AND"). Damit gilt für das Gesamtprädikat immer
 *    `(<bisheriges Prädikat>) AND tenantId == <ctx>` -> keine Zeile eines anderen
 *    Tenants kann je matchen.
 *  - Unbekanntes Modell in einer gescopeten Methode -> Fehler (default-deny),
 *    statt es ungescopet durchzureichen.
 *
 * `tenantId` ist der LOGISCHE Feldname; better-auth mappt ihn selbst auf die
 * Spalte (via `transformInput`/`transformWhereClause` der darunterliegenden
 * Adapter-Factory). Deshalb wickeln wir den ÄUSSEREN `DBAdapter` (den
 * better-auth-Core aufruft) und übergeben logische Feldnamen.
 *
 * WICHTIG zur Persistenz: better-auths Adapter-Factory verwirft in
 * `transformInput` jedes Feld, das NICHT im Schema steht, und `transformWhereClause`
 * schlägt für unbekannte Felder fehl. Damit `tenantId` überlebt bzw. filterbar
 * ist, MUSS `tenantId` als (additional) Field jedes gescopeten Modells im Schema
 * deklariert sein (siehe `auth.ts` -> user/session/account/verification).
 */

/** Logischer Feldname der Tenant-Diskriminante (nicht die DB-Spalte). */
const TENANT_FIELD = "tenantId";

/**
 * Modelle, deren Zeilen genau EINEM Tenant gehören und deshalb gescopet werden.
 * "twoFactor" ist der Modell-Key des better-auth two-factor-Plugins
 * (Default `twoFactorTable: "twoFactor"`). Er ist hier bereits gelistet, damit
 * die Isolation sofort greift, sobald das Plugin aktiviert wird — ohne weitere
 * Code-Änderung. (Das Plugin ist in diesem Schritt NICHT geladen, der Eintrag
 * ist bis dahin inert.)
 */
const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  "user",
  "session",
  "account",
  "verification",
  "twoFactor",
]);

/**
 * Modelle, die bewusst NICHT tenant-gebunden sind und ungescopet durchlaufen
 * dürfen. Die better-auth-interne Rate-Limit-Tabelle ist nach Request-Identifier
 * (z. B. IP) verschlüsselt, nicht nach Tenant; sie trägt keine Kundendaten und
 * wird ohnehin nur genutzt, wenn `rateLimit.storage === "database"`. Beide
 * Schreibweisen (Modell-Key `rateLimit`, Legacy `rate-limit`) sind abgedeckt.
 */
const TENANT_EXEMPT_MODELS: ReadonlySet<string> = new Set(["rateLimit", "rate-limit"]);

/**
 * Entscheidet, ob ein Modell gescopet werden muss.
 * @returns true = scopen, false = bewusst ungescopet durchreichen.
 * @throws bei unbekanntem Modell (default-deny).
 */
function mustScope(model: string): boolean {
  if (TENANT_SCOPED_MODELS.has(model)) return true;
  if (TENANT_EXEMPT_MODELS.has(model)) return false;
  throw new Error(
    `tenantAwareAdapter: default-deny — Modell "${model}" ist weder tenant-gescopet ` +
      `noch explizit ausgenommen. Ausführung verweigert. Modell explizit klassifizieren.`,
  );
}

/**
 * Hängt `tenantId == <aktueller Tenant>` (connector `AND`) an eine where-Klausel an.
 *
 * SQL-LEVEL-SICHERHEIT (verifiziert gegen better-auth v1.6.23 Kysely-Adapter,
 * `@better-auth/kysely-adapter/dist/index.mjs` -> `convertWhereClause`):
 * Der Adapter GRUPPIERT die where-Liste nach `connector`: alle `AND`-Bedingungen
 * kommen in EINE `eb.and([...])`-Gruppe, alle `OR`-Bedingungen in EINE
 * `eb.or([...])`-Gruppe; beide Gruppen werden über ZWEI getrennte `.where()`-
 * Aufrufe per Top-Level-`AND` verknüpft. Für eine gemischte Liste entsteht also:
 *   `WHERE (<alle ANDs inkl. tenantId>) AND (<alle ORs>)`
 * — die geklammerte OR-Gruppe wird als Ganzes vom Tenant gegattet. Weil unsere
 * Klausel IMMER `connector: "AND"` trägt, landet sie stets in der AND-Gruppe und
 * bindet damit über das GESAMTE Prädikat (unabhängig von ihrer Array-Position).
 * Das befürchtete `... OR (... AND tenantId)` kann NICHT entstehen; ein
 * Trailing-`AND` ist unter diesem Adapter sicher — KEINE Härtung nötig.
 * Empirischer Beweis + Regressionswächter: `auth.sql-isolation.test.ts`
 * (Fall SQL-3 zeigt: mit `connector: "OR"` würde exakt dieselbe Maschinerie
 * leaken — der `AND`-Connector hier ist also tragend).
 */
function withTenant(where: Where[] | undefined): Where[] {
  const clause: Where = {
    field: TENANT_FIELD,
    value: currentTenantIdOrThrow(),
    operator: "eq",
    connector: "AND",
  };
  return where && where.length > 0 ? [...where, clause] : [clause];
}

/** Injiziert `tenantId` in die zu schreibenden Daten. */
function injectTenant<T extends Record<string, unknown>>(data: T): T & Record<string, unknown> {
  return { ...data, [TENANT_FIELD]: currentTenantIdOrThrow() };
}

/**
 * Baut die tenant-gescopeten Kernmethoden (ohne `transaction`), teilbar zwischen
 * dem äußeren Adapter und dem Transaktions-Adapter (`trx`). KEIN Proxy/Catch-all:
 * jede Methode ist explizit implementiert, damit nichts versehentlich ungescopet
 * durchgereicht wird.
 */
function buildScopedMethods(inner: DBTransactionAdapter): DBTransactionAdapter {
  return {
    id: inner.id,
    options: inner.options,
    createSchema: inner.createSchema,

    create: <T extends Record<string, any>, R = T>(args: {
      model: string;
      data: Omit<T, "id">;
      select?: string[];
      forceAllowId?: boolean;
    }): Promise<R> =>
      mustScope(args.model)
        ? inner.create<T, R>({
            ...args,
            data: injectTenant(args.data as Record<string, unknown>) as Omit<T, "id">,
          })
        : inner.create<T, R>(args),

    findOne: <T>(args: Parameters<DBTransactionAdapter["findOne"]>[0]): Promise<T | null> =>
      mustScope(args.model)
        ? inner.findOne<T>({ ...args, where: withTenant(args.where) })
        : inner.findOne<T>(args),

    findMany: <T>(args: Parameters<DBTransactionAdapter["findMany"]>[0]): Promise<T[]> =>
      mustScope(args.model)
        ? inner.findMany<T>({ ...args, where: withTenant(args.where) })
        : inner.findMany<T>(args),

    count: (args: Parameters<DBTransactionAdapter["count"]>[0]): Promise<number> =>
      mustScope(args.model)
        ? inner.count({ ...args, where: withTenant(args.where) })
        : inner.count(args),

    update: <T>(args: Parameters<DBTransactionAdapter["update"]>[0]): Promise<T | null> =>
      mustScope(args.model)
        ? inner.update<T>({ ...args, where: withTenant(args.where) })
        : inner.update<T>(args),

    updateMany: (args: Parameters<DBTransactionAdapter["updateMany"]>[0]): Promise<number> =>
      mustScope(args.model)
        ? inner.updateMany({ ...args, where: withTenant(args.where) })
        : inner.updateMany(args),

    delete: <T>(args: Parameters<DBTransactionAdapter["delete"]>[0]): Promise<void> =>
      mustScope(args.model)
        ? inner.delete<T>({ ...args, where: withTenant(args.where) })
        : inner.delete<T>(args),

    deleteMany: (args: Parameters<DBTransactionAdapter["deleteMany"]>[0]): Promise<number> =>
      mustScope(args.model)
        ? inner.deleteMany({ ...args, where: withTenant(args.where) })
        : inner.deleteMany(args),

    consumeOne: <T>(args: Parameters<DBTransactionAdapter["consumeOne"]>[0]): Promise<T | null> =>
      mustScope(args.model)
        ? inner.consumeOne<T>({ ...args, where: withTenant(args.where) })
        : inner.consumeOne<T>(args),

    incrementOne: <T>(args: Parameters<DBTransactionAdapter["incrementOne"]>[0]): Promise<T | null> =>
      mustScope(args.model)
        ? inner.incrementOne<T>({ ...args, where: withTenant(args.where) })
        : inner.incrementOne<T>(args),
  };
}

/**
 * Umschließt einen `DBAdapter` so, dass jede tenant-gebundene Operation an den
 * aktuellen Tenant-Kontext gekoppelt ist. Transaktionen werden ebenfalls
 * gescopet: der `trx`, den better-auth-Core innerhalb von `runWithTransaction`
 * benutzt, ist wieder ein tenant-gescopeter Adapter.
 */
export function tenantAwareAdapter(inner: DBAdapter): DBAdapter {
  const scoped = buildScopedMethods(inner);
  return {
    ...scoped,
    transaction: <R>(cb: (trx: DBTransactionAdapter) => Promise<R>): Promise<R> =>
      inner.transaction((innerTrx) => cb(buildScopedMethods(innerTrx))),
  };
}
