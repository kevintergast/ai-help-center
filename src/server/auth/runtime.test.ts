import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { createAuth, tenantBaseURL } from "./runtime";
import { createSqliteAuthSchema } from "./sqlite-test-support";
import { runWithTenant } from "./tenant-context";

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "t_acme",
    slug: "acme",
    name: "Acme",
    customDomain: null,
    defaultLocale: "de",
    branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
    ...overrides,
  };
}

describe("tenantBaseURL", () => {
  it("leitet die Subdomain aus dem Slug ab", () => {
    expect(tenantBaseURL(tenant({ slug: "acme", customDomain: null }))).toBe(
      "https://acme.hallofhelp.com",
    );
  });
  it("ignoriert eine gesetzte Custom-Domain (kein Ownership-Beweis → nie Secrets dorthin, A-7)", () => {
    // Regression: vor dem Fix trugen Einladungs-/Reset-Links das Roh-Token auf
    // einen unverifizierten, potenziell fremd-kontrollierten Host.
    expect(tenantBaseURL(tenant({ slug: "acme", customDomain: "help.acme.com" }))).toBe(
      "https://acme.hallofhelp.com",
    );
  });
});

describe("createAuth (D1-Runtime-Factory, SQLite-Stand-in)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSqliteAuthSchema(db);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  // env.DB wird von better-auth automatisch als SQLite erkannt; für den
  // Smoke-Test genügt das (der D1-spezifische Dialekt läuft nur im echten Worker).
  function fakeEnv() {
    return { DB: db, AUTH_SECRET: TEST_SECRET } as unknown as CloudflareEnv;
  }

  it("setzt baseURL aus dem Tenant (behebt die 'Base URL not set'-Warnung)", async () => {
    const auth = await createAuth(fakeEnv(), tenant());
    expect(auth.options.baseURL).toBe("https://acme.hallofhelp.com");
  });

  it("erzeugt eine funktionierende, tenant-isolierte Instanz (Insert trägt tenantId, Cross-Tenant-Read = null)", async () => {
    const auth = await createAuth(fakeEnv(), tenant({ id: "t_acme" }));

    const res = await runWithTenant("t_acme", () =>
      auth.api.signUpEmail({
        body: { email: "owner@example.com", password: "correct-horse-battery-staple", name: "Owner" },
        headers: new Headers(),
      }),
    );
    expect(res.user).toBeTruthy();

    const rows = db
      .prepare("SELECT tenant_id, email FROM auth_user WHERE email = ?")
      .all("owner@example.com") as Array<{ tenant_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe("t_acme");

    // Aus einem fremden Tenant heraus ist der User über den gewrappten Adapter unauffindbar.
    const auth2 = await createAuth(fakeEnv(), tenant({ id: "t_other", slug: "other" }));
    const cross = await runWithTenant("t_other", () =>
      auth2.api.signUpEmail({
        body: { email: "owner@example.com", password: "another-correct-horse-xyz", name: "Owner2" },
        headers: new Headers(),
      }),
    );
    // Gleiche E-Mail in anderem Tenant ist erlaubt -> eigener User, eigene tenantId.
    expect(cross.user).toBeTruthy();
    const all = db
      .prepare("SELECT tenant_id FROM auth_user WHERE email = ? ORDER BY tenant_id")
      .all("owner@example.com") as Array<{ tenant_id: string }>;
    expect(all.map((r) => r.tenant_id)).toEqual(["t_acme", "t_other"]);
  });
});
