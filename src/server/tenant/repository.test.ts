import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { D1TenantRepository, deriveLogoUrl, rowToTenant } from "./repository";

const row = {
  id: "t_x",
  slug: "x",
  name: "X",
  custom_domain: null,
  default_locale: "en",
  logo_url: null,
  logo_r2_key: null,
  branding_updated_at: null,
  color_primary: "#111111",
  color_accent: "#222222",
  color_primary_fg: "#ffffff",
  seo_indexable: 1,
  support_email: null,
};

describe("rowToTenant", () => {
  it("mappt eine D1-Zeile auf das Tenant-Objekt", () => {
    expect(rowToTenant(row)).toMatchObject({
      id: "t_x",
      slug: "x",
      customDomain: null,
      defaultLocale: "en",
      branding: { colorPrimary: "#111111", logoUrl: null },
    });
  });
});

describe("deriveLogoUrl (Prioritätskette R2 → extern → null)", () => {
  it("R2-Key gesetzt → tenant-scoped Serving-Route mit Cache-Buster-Version", () => {
    expect(
      deriveLogoUrl({ logo_r2_key: "tenants/t_x/logo", branding_updated_at: 1700000000, logo_url: null }),
    ).toBe("/api/v1/branding/logo?v=1700000000");
  });

  it("R2-Key gewinnt gegenüber einer externen logo_url", () => {
    expect(
      deriveLogoUrl({
        logo_r2_key: "tenants/t_x/logo",
        branding_updated_at: 42,
        logo_url: "https://cdn.example.com/logo.png",
      }),
    ).toBe("/api/v1/branding/logo?v=42");
  });

  it("kein R2-Key → externe logo_url; ohne beides → null", () => {
    expect(
      deriveLogoUrl({ logo_r2_key: null, branding_updated_at: null, logo_url: "https://cdn.example.com/l.png" }),
    ).toBe("https://cdn.example.com/l.png");
    expect(deriveLogoUrl({ logo_r2_key: null, branding_updated_at: null, logo_url: null })).toBeNull();
  });
});

describe("D1TenantRepository", () => {
  it("getBySlug fragt D1 ab und mappt das Ergebnis", async () => {
    const fakeDb = {
      prepare: () => ({ bind: () => ({ first: async () => row }) }),
    } as unknown as D1Database;

    const repo = new D1TenantRepository(fakeDb);
    const tenant = await repo.getBySlug("x");
    expect(tenant?.slug).toBe("x");
    expect(tenant?.defaultLocale).toBe("en");
  });

  it("getBySlug gibt null zurück, wenn nichts gefunden wird", async () => {
    const fakeDb = {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    } as unknown as D1Database;

    const repo = new D1TenantRepository(fakeDb);
    expect(await repo.getBySlug("nope")).toBeNull();
  });

  it("getByCustomDomain löst NUR über eine VERIFIZIERTE tenant_domain auf (A-7, echte Migrations-DDL)", async () => {
    // Verhinderter realer Fehlerfall: eine eingetragene, aber nie per
    // TXT-Proof bewiesene Domain (Vertipper/Fremd-Claim) würde Requests —
    // und damit Auth — auf den Tenant auflösen.
    const db = new Database(":memory:");
    applyMigrations(db, [
      "0001_tenants.sql",
      "0002_auth.sql",
      "0003_branding.sql",
      "0004_two_factor_plugin_columns.sql",
      "0013_seo_indexable.sql", "0021_tenant_suspend.sql",
      "0014_support_email.sql",
    ]);
    db.prepare(
      "INSERT INTO tenants (id, slug, name, custom_domain) VALUES ('t_c', 'corp', 'Corp', 'help.corp.example')",
    ).run();
    const repo = new D1TenantRepository(d1FromSqlite(db));

    // Ohne tenant_domain-Eintrag (heutiger Normalfall): fail-closed null.
    expect(await repo.getByCustomDomain("help.corp.example")).toBeNull();

    // pending reicht nicht:
    db.prepare(
      `INSERT INTO tenant_domain (id, tenant_id, domain, verification_token, status)
       VALUES ('d1', 't_c', 'help.corp.example', 'txt-proof', 'pending')`,
    ).run();
    expect(await repo.getByCustomDomain("help.corp.example")).toBeNull();

    // erst verified öffnet die Auflösung:
    db.prepare("UPDATE tenant_domain SET status = 'verified' WHERE id = 'd1'").run();
    expect((await repo.getByCustomDomain("help.corp.example"))?.id).toBe("t_c");

    // Slug-Auflösung bleibt davon unberührt:
    expect((await repo.getBySlug("corp"))?.id).toBe("t_c");
    db.close();
  });
});

describe("Instanz-Sperre (0021, Ops)", () => {
  // Verhinderter realer Fehlerfall: eine im Ops-Dashboard blockierte Instanz
  // bliebe über Subdomain ODER Custom-Domain weiter erreichbar.
  it("suspended_at gesetzt → weder Slug- noch Domain-Auflösung; NULL → wieder da", async () => {
    const db = new Database(":memory:");
    applyMigrations(db, [
      "0001_tenants.sql",
      "0002_auth.sql",
      "0003_branding.sql",
      "0004_two_factor_plugin_columns.sql",
      "0013_seo_indexable.sql", "0021_tenant_suspend.sql",
      "0014_support_email.sql",
    ]);
    // Migration 0001 seedet 'demo'; Custom-Domain verified dazu:
    db.prepare("UPDATE tenants SET custom_domain = 'help.demo.example' WHERE slug = 'demo'").run();
    db.prepare(
      `INSERT INTO tenant_domain (id, tenant_id, domain, verification_token, status)
       SELECT 'd9', id, 'help.demo.example', 'txt', 'verified' FROM tenants WHERE slug = 'demo'`,
    ).run();
    const repo = new D1TenantRepository(d1FromSqlite(db));
    expect((await repo.getBySlug("demo"))?.slug).toBe("demo");
    expect((await repo.getByCustomDomain("help.demo.example"))?.slug).toBe("demo");

    db.prepare(`UPDATE tenants SET suspended_at = 123 WHERE slug = 'demo'`).run();
    expect(await repo.getBySlug("demo")).toBeNull();
    expect(await repo.getByCustomDomain("help.demo.example")).toBeNull();

    db.prepare(`UPDATE tenants SET suspended_at = NULL WHERE slug = 'demo'`).run();
    expect((await repo.getBySlug("demo"))?.slug).toBe("demo");
    db.close();
  });
});
