import BetterSqlite3 from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { D1TenantRepository } from "@/server/tenant/repository";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";

/**
 * SEO-Opt-out-Einstellung (PUT /admin/settings/seo) end-to-end gegen echte
 * 0013-DDL. Verhinderte Fehlerfälle:
 *  - Nicht-Owner (auch admin!) können die öffentliche Auffindbarkeit der
 *    ganzen Instanz umschalten (Owner-Gate-Bruch).
 *  - Der Schalter schreibt, aber der zentrale Sitemap-Index listet die
 *    Instanz trotzdem weiter (listSlugs-Filter kaputt = Opt-out wirkungslos).
 */

const HOST_DEMO = "demo.hallofhelp.com";
const TENANT_DEMO: Tenant = {
  id: "t_demo",
  slug: "demo",
  name: "Demo",
  customDomain: null,
  defaultLocale: "de",
  branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
};
const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";
const PASSWORD = "correct-horse-battery";
type Row = Record<string, unknown>;

function makeFixture(opts: { settingsAvailable?: boolean } = {}) {
  const { settingsAvailable = true } = opts;
  const sqlite = new BetterSqlite3(":memory:");
  applyMigrations(sqlite, ["0001_tenants.sql", "0021_tenant_suspend.sql", "0023_logo_dark.sql", "0003_branding.sql", "0013_seo_indexable.sql", "0014_support_email.sql"]);
  const repo = new D1TenantRepository(d1FromSqlite(sqlite));

  const authDb: Record<string, Row[]> = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const deps: ApiDeps = {
    resolveTenant: async (host) =>
      (host ?? "").split(":")[0].toLowerCase() === HOST_DEMO ? TENANT_DEMO : null,
    createAuthForTenant: async () =>
      buildAuth({
        adapter: memoryAdapter(authDb)(tenantAuthOptions(TEST_SECRET)),
        secret: TEST_SECRET,
      }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
    getSettingsDeps: async () =>
      settingsAvailable
        ? {
            setSeoIndexable: (tenantId, indexable) => repo.setSeoIndexable(tenantId, indexable),
            setSupportEmail: (tenantId, email) => repo.setSupportEmail(tenantId, email),
            setDefaultLocale: (tenantId, locale) => repo.setDefaultLocale(tenantId, locale),
          }
        : null,
  };
  return { app: buildApiApp(deps), sqlite, repo, authDb };
}

type Fixture = ReturnType<typeof makeFixture>;

/** Session mit Rolle + MFA-Markern (Muster app.domain.test.ts). */
async function session(
  f: Fixture,
  email: string,
  role: "user" | "admin" | "owner",
): Promise<string> {
  const post = (path: string, body: unknown) =>
    f.app.request(path, {
      method: "POST",
      headers: { host: HOST_DEMO, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (await post(`${AUTH_BASE_PATH}/sign-up/email`, { email, password: PASSWORD, name: "U" }))
      .status,
  ).toBe(200);
  const user = f.authDb.auth_user.find((u) => u.email === email)!;
  user.email_verified = true;
  if (role !== "user") user.role = role;
  const signIn = await post(`${AUTH_BASE_PATH}/sign-in/email`, { email, password: PASSWORD });
  expect(signIn.status).toBe(200);
  if (role !== "user") {
    user.two_factor_enabled = true;
    const s = f.authDb.auth_session.filter((x) => x.user_id === user.id).at(-1)!;
    s.mfa_verified = true;
  }
  return signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const putSeo = (f: Fixture, body: unknown, cookie?: string) =>
  f.app.request("/api/v1/admin/settings/seo", {
    method: "PUT",
    headers: {
      host: HOST_DEMO,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

// Migration 0001 seedet bereits demo+acme — kein eigener Tenant-Seed nötig.

describe("PUT /api/v1/admin/settings/seo (Owner-Gate + Wirkung)", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it("anonym → 401 (Route ist nicht public)", async () => {
    expect((await putSeo(f, { indexable: false })).status).toBe(401);
  });

  it("admin → 403 UND nichts persistiert (Owner-only, admin reicht bewusst nicht)", async () => {
    const cookie = await session(f, "admin@example.com", "admin");
    const res = await putSeo(f, { indexable: false }, cookie);
    expect(res.status).toBe(403);
    expect(await f.repo.listSlugs()).toContain("demo");
  });

  it("owner: Opt-out persistiert + fliegt aus dem Sitemap-Index; Rücknahme kehrt zurück", async () => {
    const cookie = await session(f, "owner@example.com", "owner");

    const off = await putSeo(f, { indexable: false }, cookie);
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ ok: true, indexable: false });
    // Wirkung 1: Spalte umgestellt (rowToTenant → seoIndexable=false).
    expect((await f.repo.getBySlug("demo"))?.seoIndexable).toBe(false);
    // Wirkung 2: raus aus dem zentralen Sitemap-Index (listSlugs-Filter);
    // andere Tenants (acme-Seed) bleiben unberührt.
    expect(await f.repo.listSlugs()).toEqual(["acme"]);

    const on = await putSeo(f, { indexable: true }, cookie);
    expect(on.status).toBe(200);
    expect((await f.repo.getBySlug("demo"))?.seoIndexable).toBe(true);
    expect(await f.repo.listSlugs()).toEqual(["acme", "demo"]);
  });

  it("ungültiger Body → 400; fehlende Bindings → 503 (fail-closed)", async () => {
    const cookie = await session(f, "owner2@example.com", "owner");
    expect((await putSeo(f, { indexable: "ja" }, cookie)).status).toBe(400);

    const without = makeFixture({ settingsAvailable: false });
    const ownerCookie = await session(without, "owner3@example.com", "owner");
    expect((await putSeo(without, { indexable: false }, ownerCookie)).status).toBe(503);
  });
});

const putSupport = (f: Fixture, body: unknown, cookie?: string) =>
  f.app.request("/api/v1/admin/settings/support", {
    method: "PUT",
    headers: {
      host: HOST_DEMO,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

describe("PUT /api/v1/admin/settings/support (der frühere Speichern-Bug)", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it("admin: speichert kanonisiert, persistiert am Tenant; Leeren entfernt", async () => {
    const cookie = await session(f, "admin@example.com", "admin");

    const set = await putSupport(f, { email: " Hilfe@Firma.DE " }, cookie);
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ ok: true, email: "hilfe@firma.de" });
    expect((await f.repo.getBySlug("demo"))?.supportEmail).toBe("hilfe@firma.de");

    const clear = await putSupport(f, { email: null }, cookie);
    expect(clear.status).toBe(200);
    expect((await f.repo.getBySlug("demo"))?.supportEmail).toBeNull();
  });

  it("user-Rolle → 403 (admin-Gate); anonym → 401; Unsinn → 400 invalid_email", async () => {
    expect((await putSupport(f, { email: "a@b.de" })).status).toBe(401);

    const userCookie = await session(f, "user@example.com", "user");
    expect((await putSupport(f, { email: "a@b.de" }, userCookie)).status).toBe(403);

    const adminCookie = await session(f, "admin2@example.com", "admin");
    expect((await putSupport(f, { email: "kein-at-zeichen" }, adminCookie)).status).toBe(400);
    expect((await putSupport(f, { email: 42 }, adminCookie)).status).toBe(400);
    expect((await f.repo.getBySlug("demo"))?.supportEmail).toBeNull();
  });
});

const putLocale = (f: Fixture, body: unknown, cookie?: string) =>
  f.app.request("/api/v1/admin/settings/locale", {
    method: "PUT",
    headers: {
      host: HOST_DEMO,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

describe("PUT /api/v1/admin/settings/locale (Instanzsprache, Owner-Gate)", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  // Verhinderte Fehlerfälle: admin kann die Sprache der GANZEN Instanz kippen
  // (Grundsatzentscheidung wie SEO), oder unbekannte Locales landen in der DB
  // (rowToTenant würde still auf "de" zurückfallen = Schein-Speicherung).
  it("owner: persistiert; admin → 403; Unsinn → 400", async () => {
    const owner = await session(f, "owner-loc@example.com", "owner");
    const res = await putLocale(f, { locale: "en" }, owner);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, locale: "en" });
    expect((await f.repo.getBySlug("demo"))?.defaultLocale).toBe("en");

    const admin = await session(f, "admin-loc@example.com", "admin");
    expect((await putLocale(f, { locale: "de" }, admin)).status).toBe(403);
    expect((await f.repo.getBySlug("demo"))?.defaultLocale).toBe("en"); // unverändert

    expect((await putLocale(f, { locale: "fr" }, owner)).status).toBe(400);
    expect((await putLocale(f, { locale: 1 }, owner)).status).toBe(400);
  });
});
