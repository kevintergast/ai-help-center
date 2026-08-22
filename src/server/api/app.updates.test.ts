import BetterSqlite3 from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { D1UpdatesStore } from "@/server/content/updates";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";

/**
 * CHANGELOG-/ROADMAP-PFLEGE über die API (0030). Verhinderte Fehlerfälle:
 *  - Endnutzer (Rolle `user`) können den öffentlichen Changelog schreiben.
 *  - Eine erfundene Stufe („huge") landet ungeprüft in der DB.
 *  - Eine Änderung geht durch, ohne den Such-Index nachzuziehen → die KI
 *    antwortet mit Changelog-Ständen, die es nicht mehr gibt.
 *  - Ohne D1-Bindings wird stillschweigend „ok" gemeldet (statt 503).
 */

const HOST = "demo.hallofhelp.com";
const TENANT: Tenant = {
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

function makeFixture(opts: { storeAvailable?: boolean } = {}) {
  const { storeAvailable = true } = opts;
  const sqlite = new BetterSqlite3(":memory:");
  applyMigrations(sqlite, ["0001_tenants.sql", "0005_content.sql", "0030_changelog_version.sql"]);
  const store = new D1UpdatesStore(d1FromSqlite(sqlite));

  const authDb: Record<string, Row[]> = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  // Recorder: beweist, dass Mutationen den Index nachziehen.
  const rebuilds: string[] = [];

  const deps: ApiDeps = {
    resolveTenant: async (host) =>
      (host ?? "").split(":")[0].toLowerCase() === HOST ? TENANT : null,
    createAuthForTenant: async () =>
      buildAuth({
        adapter: memoryAdapter(authDb)(tenantAuthOptions(TEST_SECRET)),
        secret: TEST_SECRET,
      }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
    getUpdatesStore: async () => (storeAvailable ? store : null),
    getContentIndexer: async () => ({
      onContentChange: async () => {},
      rebuildTenant: async (tenantId: string) => {
        rebuilds.push(tenantId);
        return { articles: 0, chunks: 0, embedded: 0 };
      },
    }),
  };
  return { app: buildApiApp(deps), store, authDb, rebuilds };
}

type Fixture = ReturnType<typeof makeFixture>;

async function session(f: Fixture, email: string, role: "user" | "content"): Promise<string> {
  const post = (path: string, body: unknown) =>
    f.app.request(path, {
      method: "POST",
      headers: { host: HOST, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (await post(`${AUTH_BASE_PATH}/sign-up/email`, { email, password: PASSWORD, name: "U" })).status,
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

const call = (f: Fixture, path: string, method: string, body?: unknown, cookie?: string) =>
  f.app.request(path, {
    method,
    headers: {
      host: HOST,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

describe("Changelog-Pflege (/api/v1/admin/changelog)", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it("anonym → 401; Endnutzer → 403; content darf schreiben", async () => {
    expect((await call(f, "/api/v1/admin/changelog", "GET")).status).toBe(401);

    const user = await session(f, "leser@example.com", "user");
    expect((await call(f, "/api/v1/admin/changelog", "POST", { title: "X" }, user)).status).toBe(403);
    expect(await f.store.listChangelog("t_demo")).toEqual([]);

    const editor = await session(f, "redaktion@example.com", "content");
    const res = await call(
      f,
      "/api/v1/admin/changelog",
      "POST",
      { title: "Widget", description: "Neu", version: "2.4.0", level: "minor" },
      editor,
    );
    expect(res.status).toBe(201);
    const { entry } = (await res.json()) as { entry: { id: string; version: string; level: string } };
    expect(entry).toMatchObject({ version: "2.4.0", level: "minor" });
    // Index nachgezogen (Changelog ist RAG-Quelle).
    expect(f.rebuilds).toContain("t_demo");
  });

  it("ändern und löschen; unbekannte Id → 404", async () => {
    const editor = await session(f, "redaktion2@example.com", "content");
    const created = await (
      await call(f, "/api/v1/admin/changelog", "POST", { title: "Alt" }, editor)
    ).json();
    const id = (created as { entry: { id: string } }).entry.id;

    const put = await call(
      f,
      `/api/v1/admin/changelog/${id}`,
      "PUT",
      { title: "Neu", description: "", version: "R25-08", level: "patch" },
      editor,
    );
    expect(put.status).toBe(200);
    expect((await f.store.listChangelog("t_demo"))[0]).toMatchObject({
      title: "Neu",
      version: "R25-08",
    });

    expect((await call(f, "/api/v1/admin/changelog/cl_weg", "PUT", { title: "X" }, editor)).status).toBe(404);
    expect((await call(f, `/api/v1/admin/changelog/${id}`, "DELETE", undefined, editor)).status).toBe(200);
    expect(await f.store.listChangelog("t_demo")).toEqual([]);
    expect((await call(f, `/api/v1/admin/changelog/${id}`, "DELETE", undefined, editor)).status).toBe(404);
  });

  it("Validierung: leerer Titel und erfundene Stufe → 400, nichts gespeichert", async () => {
    const editor = await session(f, "redaktion3@example.com", "content");
    expect((await call(f, "/api/v1/admin/changelog", "POST", { title: "  " }, editor)).status).toBe(400);
    expect(
      (await call(f, "/api/v1/admin/changelog", "POST", { title: "T", level: "huge" }, editor)).status,
    ).toBe(400);
    expect(await f.store.listChangelog("t_demo")).toEqual([]);
  });

  it("ohne D1-Bindings → 503 (kein stiller Erfolg)", async () => {
    const without = makeFixture({ storeAvailable: false });
    const editor = await session(without, "redaktion4@example.com", "content");
    expect(
      (await call(without, "/api/v1/admin/changelog", "POST", { title: "T" }, editor)).status,
    ).toBe(503);
  });
});

describe("Roadmap-Pflege (/api/v1/admin/roadmap)", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it("anlegen, ändern, löschen — Endnutzer bleibt ausgesperrt", async () => {
    const user = await session(f, "leser-rm@example.com", "user");
    expect((await call(f, "/api/v1/admin/roadmap", "POST", { title: "X" }, user)).status).toBe(403);

    const editor = await session(f, "redaktion-rm@example.com", "content");
    const created = await call(
      f,
      "/api/v1/admin/roadmap",
      "POST",
      { title: "Voice-Bot", status: "planned" },
      editor,
    );
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { item: { id: string } }).item.id;

    const put = await call(
      f,
      `/api/v1/admin/roadmap/${id}`,
      "PUT",
      { title: "Voice-Bot", status: "in_progress" },
      editor,
    );
    expect(put.status).toBe(200);
    expect((await f.store.listRoadmap("t_demo"))[0]).toMatchObject({ status: "in_progress" });

    expect((await call(f, `/api/v1/admin/roadmap/${id}`, "DELETE", undefined, editor)).status).toBe(200);
    expect(await f.store.listRoadmap("t_demo")).toEqual([]);
  });

  it("unbekannter Status → 400", async () => {
    const editor = await session(f, "redaktion-rm2@example.com", "content");
    expect(
      (await call(f, "/api/v1/admin/roadmap", "POST", { title: "T", status: "vielleicht" }, editor))
        .status,
    ).toBe(400);
  });
});
