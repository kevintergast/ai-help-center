import { memoryAdapter } from "better-auth/adapters/memory";
import type { DBAdapter } from "better-auth";
import { describe, expect, it } from "vitest";
import { buildAuth, tenantAuthOptions } from "./auth";
import { runWithTenant } from "./tenant-context";
import { tenantAwareAdapter } from "./tenant-adapter";

/**
 * Integrationstest des ISOLATIONS-KERNS mit dem echten better-auth
 * `memoryAdapter` (kein D1, kein echtes Secret). Test-Secret >= 32 Zeichen.
 */
const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF"; // 40 Zeichen

/**
 * Frische In-Memory-DB mit allen von better-auth genutzten Tabellen.
 * Keys = gemappte Tabellennamen (modelName-Mapping auf das Migrations-Schema);
 * die Adapter-Factory uebersetzt Modell-/Feldnamen VOR dem Store-Zugriff.
 */
function freshDb(): Record<string, unknown[]> {
  return { auth_user: [], auth_session: [], auth_account: [], auth_verification: [] };
}

/**
 * Instanziert den Memory-Adapter mit EXAKT den Optionen aus `tenantAuthOptions`,
 * damit dessen Schema `tenantId` auf allen gescopeten Modellen kennt (sonst
 * würde `transformInput` das injizierte Feld verwerfen). Gibt sowohl die DB
 * (zum Inspizieren des Roh-States) als auch den fertigen Adapter zurück.
 */
function freshMemoryAdapter(db: Record<string, unknown[]>): DBAdapter {
  return memoryAdapter(db)(tenantAuthOptions(TEST_SECRET));
}

describe("Auth Tenant-Isolation (memoryAdapter, echte better-auth-API)", () => {
  it("(A) gleiche E-Mail in t_a UND t_b -> beide Registrierungen gelingen, zwei getrennte User", async () => {
    const db = freshDb();
    const auth = buildAuth({ adapter: freshMemoryAdapter(db), secret: TEST_SECRET });

    const body = {
      email: "collision@example.com",
      password: "correct-horse-battery",
      name: "Collision",
    };

    const resA = await runWithTenant("t_a", () =>
      auth.api.signUpEmail({ body, headers: new Headers() }),
    );
    const resB = await runWithTenant("t_b", () =>
      auth.api.signUpEmail({ body, headers: new Headers() }),
    );

    // Beide Registrierungen erzeugen einen User (requireEmailVerification =>
    // token null, aber user vorhanden).
    expect(resA.user).toBeTruthy();
    expect(resB.user).toBeTruthy();

    // DB-State (Roh-Spalten, gemapptes Naming): genau zwei User mit dieser
    // E-Mail, je einer pro Tenant.
    const users = db.auth_user as Array<{ email: string; tenant_id: string }>;
    const withEmail = users.filter((u) => u.email === "collision@example.com");
    expect(withEmail).toHaveLength(2);
    expect(withEmail.filter((u) => u.tenant_id === "t_a")).toHaveLength(1);
    expect(withEmail.filter((u) => u.tenant_id === "t_b")).toHaveLength(1);
  });

  it("(B) in t_a angelegter User ist im Kontext t_b NICHT auffindbar (Cross-Tenant-Read = null)", async () => {
    const db = freshDb();
    const adapter = tenantAwareAdapter(freshMemoryAdapter(db));

    await runWithTenant("t_a", () =>
      adapter.create({ model: "user", data: { email: "alice@example.com", name: "Alice" } }),
    );

    const foundInA = await runWithTenant("t_a", () =>
      adapter.findOne({ model: "user", where: [{ field: "email", value: "alice@example.com" }] }),
    );
    const foundInB = await runWithTenant("t_b", () =>
      adapter.findOne({ model: "user", where: [{ field: "email", value: "alice@example.com" }] }),
    );

    expect(foundInA).toBeTruthy();
    expect(foundInB).toBeNull();
  });

  it("(C) Adapter-Aufruf OHNE Tenant-Kontext wirft (fail-closed)", async () => {
    const db = freshDb();
    const adapter = tenantAwareAdapter(freshMemoryAdapter(db));

    // Async-Wrapper: wandelt einen synchronen Throw in eine Rejection, damit der
    // Test unabhängig davon greift, ob der Wurf sync (beim where-Bau) oder async
    // (in der delegierten Operation) passiert.
    await expect(
      (async () =>
        adapter.findOne({
          model: "user",
          where: [{ field: "email", value: "nobody@example.com" }],
        }))(),
    ).rejects.toThrow();

    await expect(
      (async () => adapter.create({ model: "user", data: { email: "x@example.com", name: "X" } }))(),
    ).rejects.toThrow();
  });
});
