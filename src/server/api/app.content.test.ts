import Database from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { D1ContentRepository } from "@/server/content/store";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";

/**
 * CONTENT-ADMIN-API end-to-end über `app.request()`. Auth ist Memory-better-auth
 * (wie app.legal.test.ts); der Content-Store ist der ECHTE D1ContentRepository
 * über einen sqlite-Shim (echtes SQL, echte Migrations-DDL) — keine echten
 * Cloudflare-Bindings. Prüft: Rollen-Gating (requireTeam("content")),
 * Validierung (Video ohne description, ungültiger Slug), Tenant-Scope,
 * Lifecycle (create → draft, publish → sichtbar) und 503 ohne Binding.
 */

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";
const PASSWORD = "correct-horse-battery";
const HOST_A = "tenant-a.hallofhelp.com";
const HOST_B = "tenant-b.hallofhelp.com";

const MIGRATIONS = [
  "0001_tenants.sql",
  "0002_auth.sql",
  "0003_branding.sql",
  "0004_two_factor_plugin_columns.sql",
  "0005_content.sql",
] as const;

function makeTenant(id: string, slug: string): Tenant {
  return {
    id,
    slug,
    name: slug,
    customDomain: null,
    defaultLocale: "de",
    branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
  };
}

const TENANTS: Record<string, Tenant> = {
  [HOST_A]: makeTenant("t_a", "tenant-a"),
  [HOST_B]: makeTenant("t_b", "tenant-b"),
};

type MemoryDb = Record<string, Record<string, unknown>[]>;

function makeApp(contentAvailable = true) {
  const authDb: MemoryDb = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };

  const contentDb = new Database(":memory:");
  applyMigrations(contentDb, MIGRATIONS);
  contentDb.prepare("INSERT INTO tenants (id, slug, name) VALUES ('t_a','tenant-a','A')").run();
  contentDb.prepare("INSERT INTO tenants (id, slug, name) VALUES ('t_b','tenant-b','B')").run();
  const store = new D1ContentRepository(d1FromSqlite(contentDb));

  const deps: ApiDeps = {
    resolveTenant: async (host) => TENANTS[(host ?? "").split(":")[0].toLowerCase()] ?? null,
    createAuthForTenant: async () =>
      buildAuth({ adapter: memoryAdapter(authDb)(tenantAuthOptions(TEST_SECRET)), secret: TEST_SECRET }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => (contentAvailable ? { store } : null),
  };
  return { app: buildApiApp(deps), authDb, contentDb, store };
}

type TestApp = ReturnType<typeof makeApp>["app"];

function postJson(app: TestApp, path: string, host: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: "POST",
    headers: { host, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function createSession(
  app: TestApp,
  db: MemoryDb,
  host: string,
  email: string,
  opts: { role?: string; mfa?: boolean } = {},
): Promise<string> {
  const tenantId = TENANTS[host].id;
  const signUp = await postJson(app, `${AUTH_BASE_PATH}/sign-up/email`, host, {
    email,
    password: PASSWORD,
    name: "Test",
  });
  expect(signUp.status).toBe(200);

  const user = db.auth_user.find((u) => u.email === email && u.tenant_id === tenantId);
  user!.email_verified = true;
  if (opts.role) user!.role = opts.role;

  const signIn = await postJson(app, `${AUTH_BASE_PATH}/sign-in/email`, host, {
    email,
    password: PASSWORD,
  });
  expect(signIn.status).toBe(200);

  if (opts.mfa) {
    user!.two_factor_enabled = true;
    const session = db.auth_session.filter((s) => s.user_id === user!.id).at(-1);
    session!.mfa_verified = true;
  }

  return signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const sessionAs = (app: TestApp, db: MemoryDb, host: string, role: string) =>
  createSession(app, db, host, `${role}-${host}@example.com`, { role, mfa: true });

const VALID_ARTICLE = {
  slug: "konto-einrichten",
  title: "Konto einrichten",
  category: "Erste Schritte",
  body: ["Absatz eins."],
};

describe("POST /api/v1/admin/articles (create-Gating)", () => {
  it("ohne Session → 401; als user (mfa, aber < content) → 403; als content → 201", async () => {
    const { app, authDb } = makeApp();

    const anon = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE);
    expect(anon.status).toBe(401);

    const userCookie = await sessionAs(app, authDb, HOST_A, "user");
    const asUser = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, userCookie);
    expect(asUser.status).toBe(403);
    expect(await asUser.json()).toMatchObject({ error: "forbidden" });

    const contentCookie = await sessionAs(app, authDb, HOST_A, "content");
    const asContent = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, contentCookie);
    expect(asContent.status).toBe(201);
    expect(await asContent.json()).toMatchObject({ ok: true });
  });

  it("Validierung: Video ohne description → 400; ungültiger Slug → 400", async () => {
    const { app, authDb } = makeApp();
    const cookie = await sessionAs(app, authDb, HOST_A, "content");

    const noDesc = await postJson(app, "/api/v1/admin/articles", HOST_A, {
      ...VALID_ARTICLE,
      videos: [{ id: "v1", title: "Clip", durationLabel: "1:00" }],
    }, cookie);
    expect(noDesc.status).toBe(400);
    expect(await noDesc.json()).toMatchObject({ error: "video_description_required" });

    const badSlug = await postJson(app, "/api/v1/admin/articles", HOST_A, {
      ...VALID_ARTICLE,
      slug: "Ungültig Slug!",
    }, cookie);
    expect(badSlug.status).toBe(400);
    expect(await badSlug.json()).toMatchObject({ error: "invalid_slug" });
  });

  it("fehlendes D1-Binding → 503 fail-closed", async () => {
    const { app, authDb } = makeApp(false);
    const cookie = await sessionAs(app, authDb, HOST_A, "content");
    const res = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, cookie);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "content_unavailable" });
  });

  it("Slug-Kollision (je tenant/locale eindeutig) → 409 slug_conflict, nicht 500", async () => {
    const { app, authDb } = makeApp();
    const cookie = await sessionAs(app, authDb, HOST_A, "content");

    const first = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, cookie);
    expect(first.status).toBe(201);

    const dup = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, cookie);
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "slug_conflict" });
  });
});

describe("Lifecycle + Tenant-Scope über die API", () => {
  it("create → draft (nicht public); publish → im Store veröffentlicht", async () => {
    const { app, authDb, store } = makeApp();
    const cookie = await sessionAs(app, authDb, HOST_A, "content");

    const created = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, cookie);
    const { id } = (await created.json()) as { id: string };

    // Direkt nach create: Draft → nicht im Public-Read.
    expect(await store.searchItems("t_a", "de")).toEqual([]);

    const pub = await postJson(app, `/api/v1/admin/articles/${id}/publish`, HOST_A, {}, cookie);
    expect(pub.status).toBe(200);
    expect((await store.searchItems("t_a", "de")).map((a) => a.id)).toEqual([id]);
  });

  it("Artikel aus t_a ist über t_b nicht adressierbar (publish/update/delete → 404)", async () => {
    const { app, authDb } = makeApp();
    const cookieA = await sessionAs(app, authDb, HOST_A, "content");
    const created = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, cookieA);
    const { id } = (await created.json()) as { id: string };

    const cookieB = await sessionAs(app, authDb, HOST_B, "content");
    expect((await postJson(app, `/api/v1/admin/articles/${id}/publish`, HOST_B, {}, cookieB)).status).toBe(404);
    expect(
      (
        await app.request(`/api/v1/admin/articles/${id}`, {
          method: "PUT",
          headers: { host: HOST_B, cookie: cookieB, "content-type": "application/json" },
          body: JSON.stringify({ title: "hijack" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/admin/articles/${id}`, {
          method: "DELETE",
          headers: { host: HOST_B, cookie: cookieB },
        })
      ).status,
    ).toBe(404);
  });
});
