import Database from "better-sqlite3";
import type { DBAdapter, Where } from "better-auth";
import { getAdapter } from "better-auth/db/adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tenantAuthOptions } from "./auth";
import { createSqliteAuthSchema } from "./sqlite-test-support";
import { runWithTenant } from "./tenant-context";
import { tenantAwareAdapter } from "./tenant-adapter";

/**
 * SQL-LEVEL-ISOLATIONSBEWEIS (Aufgabe 1).
 *
 * Anders als der Memory-Adapter erzeugt better-auths Kysely-Adapter ECHTES SQL.
 * Die Sorge: unter SQL bindet `AND` staerker als `OR`, ein naiv angehaengtes
 * Trailing-`AND tenantId` koennte zu `... OR (... AND tenantId)` kollabieren = Leak.
 *
 * Dieser Test faehrt gegen ECHTES SQLite (better-sqlite3, kysely `SqliteDialect`,
 * von better-auth automatisch erkannt) und beweist empirisch:
 *  - better-auth GRUPPIERT: alle `connector:"AND"`-Bedingungen landen in EINER
 *    `eb.and([...])`-Gruppe, alle `connector:"OR"` in EINER `eb.or([...])`-Gruppe;
 *    beide Gruppen werden per Top-Level-`AND` (zwei getrennte `.where()`-Aufrufe)
 *    verknuepft. Erzeugtes SQL (Naming wie in den D1-Migrationen gemappt):
 *      WHERE "auth_user"."tenant_id" = ? AND ("auth_user"."email" = ? OR "auth_user"."name" = ?)
 *    Die Tenant-Bedingung gattert also die GESAMTE OR-Gruppe.
 *  - Das von `tenantAwareAdapter` angehaengte Trailing-`AND tenantId` ist damit
 *    unter SQL SICHER (keine Haertung noetig).
 *
 * Die Tests sind SCHARF: Kontrolle B zeigt, dass die identische Maschinerie mit
 * dem FALSCHEN Connector (`OR` statt `AND`) sehr wohl die Fremd-Tenant-Zeile
 * durchreicht — der `AND`-Connector, den `withTenant` emittiert, ist also
 * tragend. Der Verhaltenstest (Hauptfall) waere ohne diese korrekte Konstruktion
 * NICHT gruen.
 */

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";

// Adversariale OR-where-Liste: matcht INHALTLICH nur Bobs Zeile (Tenant t_b).
const OR_WHERE_MATCHING_TB: Where[] = [
  { field: "email", value: "bob@example.com", operator: "eq", connector: "OR" },
  { field: "name", value: "Bob-in-TB", operator: "eq", connector: "OR" },
];

interface Ctx {
  db: Database.Database;
  inner: DBAdapter;
  scoped: DBAdapter;
}

let ctx: Ctx;

async function seedTwoTenants(inner: DBAdapter): Promise<void> {
  // Direkter (ungewrappter) Insert mit explizit gesetzter tenantId, damit der
  // Roh-State beider Tenants deterministisch ist.
  await inner.create({
    model: "user",
    data: { email: "alice@example.com", name: "Alice-in-TA", emailVerified: false, tenantId: "t_a" },
  });
  await inner.create({
    model: "user",
    data: { email: "bob@example.com", name: "Bob-in-TB", emailVerified: false, tenantId: "t_b" },
  });
}

beforeEach(async () => {
  const db = new Database(":memory:");
  createSqliteAuthSchema(db);
  const inner = await getAdapter({ ...tenantAuthOptions(TEST_SECRET), database: db });
  ctx = { db, inner, scoped: tenantAwareAdapter(inner) };
  await seedTwoTenants(inner);
});

afterEach(() => {
  ctx.db.close();
});

describe("Auth SQL-Level-Isolation (echtes SQLite via better-auth Kysely-Adapter)", () => {
  it("(SQL-1) OR-where-Liste im Tenant t_a matcht KEINE Fremd-Tenant-Zeile (AND gattert die OR-Gruppe)", async () => {
    // Kontext t_a: die OR-Query zielt inhaltlich auf Bob (t_b).
    const inTA = await runWithTenant("t_a", () =>
      ctx.scoped.findMany<{ tenantId: string; email: string }>({
        model: "user",
        where: OR_WHERE_MATCHING_TB,
      }),
    );
    // KEINE Fremd-Tenant-Zeile, und Bob taucht nicht auf -> Ergebnis leer.
    expect(inTA.every((r) => r.tenantId === "t_a")).toBe(true);
    expect(inTA.some((r) => r.email === "bob@example.com")).toBe(false);
    expect(inTA).toHaveLength(0);

    // Positivkontrolle: dieselbe OR-Query im richtigen Tenant t_b findet Bob.
    const inTB = await runWithTenant("t_b", () =>
      ctx.scoped.findMany<{ tenantId: string; email: string }>({
        model: "user",
        where: OR_WHERE_MATCHING_TB,
      }),
    );
    expect(inTB).toHaveLength(1);
    expect(inTB[0].tenantId).toBe("t_b");
    expect(inTB[0].email).toBe("bob@example.com");
  });

  it("(SQL-2/Schaerfe A) die ungegatete OR-Query matcht die Fremd-Zeile wirklich (Test ist nicht trivial leer)", async () => {
    // Ohne Tenant-Gate (roher Adapter) liefert die OR-Query Bob (t_b) zurueck.
    const raw = await ctx.inner.findMany<{ tenantId: string; email: string }>({
      model: "user",
      where: OR_WHERE_MATCHING_TB,
    });
    expect(raw).toHaveLength(1);
    expect(raw[0].tenantId).toBe("t_b");
  });

  it("(SQL-3/Schaerfe B) OR-Gating (Fehlkonstruktion) LEAKT, AND-Gating (withTenant) nicht", async () => {
    // FALSCH: Tenant-Bedingung mit connector "OR" -> landet in der OR-Gruppe.
    // Erzeugt: WHERE (email=? OR name=? OR tenantId=?) -> Bob (t_b) leakt.
    const leaked = await ctx.inner.findMany<{ tenantId: string }>({
      model: "user",
      where: [...OR_WHERE_MATCHING_TB, { field: "tenantId", value: "t_a", operator: "eq", connector: "OR" }],
    });
    expect(leaked.some((r) => r.tenantId === "t_b")).toBe(true); // Leak nachgewiesen.

    // KORREKT (== was withTenant baut): connector "AND" -> Top-Level-AND ueber die OR-Gruppe.
    // Erzeugt: WHERE tenantId=? AND (email=? OR name=?) -> kein Fremd-Tenant.
    const safe = await ctx.inner.findMany<{ tenantId: string }>({
      model: "user",
      where: [...OR_WHERE_MATCHING_TB, { field: "tenantId", value: "t_a", operator: "eq", connector: "AND" }],
    });
    expect(safe.some((r) => r.tenantId === "t_b")).toBe(false);
    expect(safe).toHaveLength(0);
  });

  it("(SQL-4) erzeugtes SQL verknuepft tenantId per Top-Level-AND mit der geklammerten OR-Gruppe (Grouping-Regressionswaechter)", async () => {
    // Praeparierte SQL-Aufzeichnung: wir umschliessen prepare(), um das kompilierte
    // Statement der gegateten findMany zu inspizieren.
    const seen: string[] = [];
    const db = new Database(":memory:");
    createSqliteAuthSchema(db);
    const origPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      seen.push(sql);
      return origPrepare(sql);
    }) as typeof db.prepare;
    const inner = await getAdapter({ ...tenantAuthOptions(TEST_SECRET), database: db });
    const scoped = tenantAwareAdapter(inner);
    await runWithTenant("t_a", () =>
      inner.create({ model: "user", data: { email: "alice@example.com", name: "A", emailVerified: false, tenantId: "t_a" } }),
    );
    seen.length = 0;
    await runWithTenant("t_a", () => scoped.findMany({ model: "user", where: OR_WHERE_MATCHING_TB }));

    const selectSql = seen.find((s) => /select/i.test(s) && /tenant_id/i.test(s) && /email/i.test(s));
    expect(selectSql).toBeDefined();
    // tenant_id per AND mit einer geklammerten (email ... or ... name)-Gruppe
    // verknuepft — Tabellen-/Spaltennamen wie in den D1-Migrationen gemappt.
    expect(selectSql!).toMatch(/"auth_user"\."tenant_id"\s*=\s*\?\s+and\s+\(\s*"auth_user"\."email"\s*=\s*\?\s+or\s+"auth_user"\."name"\s*=\s*\?\s*\)/i);
    db.close();
  });
});
