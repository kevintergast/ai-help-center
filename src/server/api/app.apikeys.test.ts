import Database from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { D1ApiKeyRepository } from "@/server/apikeys/store";
import { hashApiKey } from "@/server/apikeys/keys";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";

/**
 * ZUGRIFFS-SCHLÜSSEL end-to-end über `app.request()`: Erstellung (nur
 * MFA-verifizierter Admin), Anzeige ohne Klartext, und vor allem die
 * AUTHENTIFIZIERUNGS-GRENZEN des Maschinen-Pfads.
 *
 * Persistenz ist der ECHTE D1ApiKeyRepository über den sqlite-Shim gegen die
 * echte Migrations-DDL (0027) — Index/PK/Constraints laufen mit.
 *
 * Der Maschinen-Pfad `/api/v1/mcp` wird hier nur als AUTH-Fläche geprüft: „ein
 * gültiger Schlüssel kommt durch die Default-Deny-Schicht" heißt „nicht 401".
 * Was dahinter passiert, ist Sache der MCP-Tests.
 */

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";
const PASSWORD = "correct-horse-battery";
const HOST_A = "tenant-a.hallofhelp.com";
const HOST_B = "tenant-b.hallofhelp.com";
const MCP_PATH = "/api/v1/mcp";

const MIGRATIONS = [
  "0001_tenants.sql", "0021_tenant_suspend.sql", "0023_logo_dark.sql", "0025_header_name.sql",
  "0002_auth.sql",
  "0004_two_factor_plugin_columns.sql",
  "0027_api_keys.sql",
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

function makeApp(opts: { keysAvailable?: boolean } = {}) {
  const authDb: MemoryDb = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };

  const db = new Database(":memory:");
  applyMigrations(db, MIGRATIONS);
  db.prepare("INSERT INTO tenants (id, slug, name) VALUES ('t_a','tenant-a','A')").run();
  db.prepare("INSERT INTO tenants (id, slug, name) VALUES ('t_b','tenant-b','B')").run();
  const repo = new D1ApiKeyRepository(d1FromSqlite(db));

  const auditEntries: { action: string; targetId?: string | null }[] = [];
  const deps: ApiDeps = {
    resolveTenant: async (host) => TENANTS[(host ?? "").split(":")[0].toLowerCase()] ?? null,
    createAuthForTenant: async () =>
      buildAuth({ adapter: memoryAdapter(authDb)(tenantAuthOptions(TEST_SECRET)), secret: TEST_SECRET }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => ({
      invitations: {} as never,
      users: {} as never,
      audit: {
        append: async (e) => {
          auditEntries.push({ action: e.action, targetId: e.targetId });
        },
      },
      sendInvitationEmail: async () => false,
    }),
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
    getApiKeyDeps: async () => (opts.keysAvailable === false ? null : { repo }),
  };

  return { app: buildApiApp(deps), authDb, db, repo, auditEntries };
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

const adminSession = (app: TestApp, db: MemoryDb, host: string, email = "admin@example.com") =>
  createSession(app, db, host, email, { role: "admin", mfa: true });

/** Legt über die API einen Schlüssel an und gibt den Klartext zurück. */
async function createKey(
  app: TestApp,
  host: string,
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await postJson(app, "/api/v1/admin/api-keys", host, body, cookie);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function mcpRequest(app: TestApp, host: string, headers: Record<string, string> = {}) {
  return app.request(MCP_PATH, {
    method: "POST",
    headers: { host, "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

describe("Zugriffs-Schlüssel — Verwaltung", () => {
  it("legt einen Schlüssel an und zeigt den Klartext GENAU EINMAL", async () => {
    const { app, authDb, auditEntries } = makeApp();
    const cookie = await adminSession(app, authDb, HOST_A);

    const created = await createKey(app, HOST_A, cookie, {
      name: "Claude Code",
      scopes: ["articles:read", "articles:write"],
    });
    expect(created.status).toBe(201);
    const token = created.json.token as string;
    expect(token.startsWith("hoh_")).toBe(true);
    expect(created.json.risk).toBe("medium");

    // Die Liste darf den Klartext nirgends mehr enthalten — sonst wäre der
    // „einmal sichtbar"-Vertrag gebrochen und ein Leseblick ins Admin genug.
    const list = await app.request("/api/v1/admin/api-keys", { headers: { host: HOST_A, cookie } });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { keys: Record<string, unknown>[] };
    expect(body.keys).toHaveLength(1);
    expect(JSON.stringify(body.keys)).not.toContain(token);
    expect(body.keys[0].keyPrefix).toBe(token.slice(0, 12));
    expect(body.keys[0].status).toBe("active");
    expect(auditEntries.map((e) => e.action)).toContain("api_key.created");
  });

  it("verlangt für zerstörende Scopes eine ausdrückliche Bestätigung", async () => {
    const { app, authDb } = makeApp();
    const cookie = await adminSession(app, authDb, HOST_A);

    // Fehlerfall: die Warn-Checkbox lebt nur im UI — wer den Request von Hand
    // schickt, bekäme sonst ein Löschrecht ohne jedes bewusste Ja.
    const without = await createKey(app, HOST_A, cookie, {
      name: "Aufräumer",
      scopes: ["articles:read", "articles:delete"],
    });
    expect(without.status).toBe(400);
    expect(without.json.error).toBe("acknowledgement_required");
    expect(without.json.scopes).toEqual(["articles:delete"]);

    const withAck = await createKey(app, HOST_A, cookie, {
      name: "Aufräumer",
      scopes: ["articles:read", "articles:delete"],
      acknowledgedScopes: ["articles:delete"],
    });
    expect(withAck.status).toBe(201);
    expect(withAck.json.risk).toBe("critical");
  });

  it("erzeugt Schlüssel nur aus einer MFA-verifizierten Admin-Session", async () => {
    const { app, authDb } = makeApp();

    // content-Rolle reicht nicht: wer Schlüssel erzeugen kann, vergibt Rechte.
    const contentCookie = await createSession(app, authDb, HOST_A, "redaktion@example.com", {
      role: "content",
      mfa: true,
    });
    const asContent = await createKey(app, HOST_A, contentCookie, {
      name: "X",
      scopes: ["articles:read"],
    });
    expect(asContent.status).toBe(403);

    // Admin ohne MFA ebenso wenig — sonst wäre der Schlüssel ein MFA-Bypass.
    const noMfa = await createSession(app, authDb, HOST_A, "admin2@example.com", { role: "admin" });
    const asNoMfa = await createKey(app, HOST_A, noMfa, { name: "X", scopes: ["articles:read"] });
    expect(asNoMfa.status).toBe(403);
    expect((asNoMfa.json as { error: string }).error).toBe("mfa_setup_required");
  });

  it("widerruft sofort", async () => {
    const { app, authDb, repo } = makeApp();
    const cookie = await adminSession(app, authDb, HOST_A);
    const created = await createKey(app, HOST_A, cookie, {
      name: "Kurzlebig",
      scopes: ["articles:read"],
    });

    const del = await app.request(`/api/v1/admin/api-keys/${created.json.id}`, {
      method: "DELETE",
      headers: { host: HOST_A, cookie },
    });
    expect(del.status).toBe(200);

    const hash = await hashApiKey(created.json.token as string);
    expect(await repo.findUsableByHash("t_a", hash, Math.floor(Date.now() / 1000))).toBeNull();

    // Zweiter Widerruf ist kein Erfolg (kein stilles „ok" auf Nicht-Existenz).
    const again = await app.request(`/api/v1/admin/api-keys/${created.json.id}`, {
      method: "DELETE",
      headers: { host: HOST_A, cookie },
    });
    expect(again.status).toBe(404);
  });
});

describe("Zugriffs-Schlüssel — Authentifizierung des Maschinen-Pfads", () => {
  it("lässt einen gültigen Schlüssel durch die Default-Deny-Schicht", async () => {
    const { app, authDb } = makeApp();
    const cookie = await adminSession(app, authDb, HOST_A);
    const { json } = await createKey(app, HOST_A, cookie, {
      name: "Agent",
      scopes: ["articles:read"],
    });

    const res = await mcpRequest(app, HOST_A, { authorization: `Bearer ${json.token as string}` });
    expect(res.status).not.toBe(401);
  });

  it("weist ohne Bearer ab — mit WWW-Authenticate", async () => {
    const { app } = makeApp();
    const res = await mcpRequest(app, HOST_A);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("akzeptiert auf dem Maschinen-Pfad KEINE Cookie-Session", async () => {
    // Das ist der CSRF-Riegel (docs/mcp-plan.md §4 E7): würde hier ein Cookie
    // zählen, könnte eine fremde Website den Endpoint im Browser des
    // eingeloggten Kunden fahren — mit dessen vollen Rechten.
    const { app, authDb } = makeApp();
    const cookie = await adminSession(app, authDb, HOST_A);
    const res = await mcpRequest(app, HOST_A, { cookie });
    expect(res.status).toBe(401);
  });

  it("weist einen Schlüssel von Tenant A auf dem Host von Tenant B ab", async () => {
    const { app, authDb } = makeApp();
    const cookie = await adminSession(app, authDb, HOST_A);
    const { json } = await createKey(app, HOST_A, cookie, {
      name: "Agent",
      scopes: ["articles:read"],
    });

    const res = await mcpRequest(app, HOST_B, { authorization: `Bearer ${json.token as string}` });
    expect(res.status).toBe(401);
  });

  it("weist widerrufene und abgelaufene Schlüssel ab", async () => {
    const { app, authDb, db, repo } = makeApp();
    const cookie = await adminSession(app, authDb, HOST_A);

    const revoked = await createKey(app, HOST_A, cookie, {
      name: "Widerrufen",
      scopes: ["articles:read"],
    });
    await repo.revoke("t_a", revoked.json.id as string, Math.floor(Date.now() / 1000));
    const revokedRes = await mcpRequest(app, HOST_A, {
      authorization: `Bearer ${revoked.json.token as string}`,
    });
    expect(revokedRes.status).toBe(401);

    const expired = await createKey(app, HOST_A, cookie, {
      name: "Abgelaufen",
      scopes: ["articles:read"],
    });
    db.prepare("UPDATE api_key SET expires_at = 1 WHERE id = ?").run(expired.json.id as string);
    const expiredRes = await mcpRequest(app, HOST_A, {
      authorization: `Bearer ${expired.json.token as string}`,
    });
    expect(expiredRes.status).toBe(401);
  });

  it("öffnet mit einem Schlüssel KEINE Menschen-Routen", async () => {
    // Der Schlüssel ist kein Session-Ersatz: /admin/* bleibt Session + MFA.
    // Sonst wäre ein Leak eines Redaktions-Schlüssels ein Admin-Zugang.
    const { app, authDb } = makeApp();
    const cookie = await adminSession(app, authDb, HOST_A);
    const { json } = await createKey(app, HOST_A, cookie, {
      name: "Agent",
      scopes: ["articles:read", "articles:write"],
    });
    const bearer = { authorization: `Bearer ${json.token as string}` };

    for (const path of ["/api/v1/admin/articles", "/api/v1/admin/api-keys", "/api/v1/admin/ping"]) {
      const res = await app.request(path, { headers: { host: HOST_A, ...bearer } });
      expect(res.status).toBe(401);
    }
  });

  it("ist ohne Key-Persistenz fail-closed (401, nicht offen)", async () => {
    const { app } = makeApp({ keysAvailable: false });
    const res = await mcpRequest(app, HOST_A, { authorization: "Bearer hoh_irgendwas" });
    expect(res.status).toBe(401);
  });
});
