import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";
import { PUBLIC_ROUTES, isPublicPath } from "./public-routes";

/**
 * SICHERHEITSTESTS: HTTP-Mount, ALS-Boundary, Guards, Default-Deny.
 * Läuft komplett mit Memory-Auth (kein D1, kein Cloudflare-Kontext) über
 * `buildApiApp` mit injizierten Fake-Deps.
 *
 * Hinweis zu MFA (Phase C): das ECHTE two-factor-Plugin ist aktiv. Die
 * End-to-End-MFA-Flows (Enrollment, verify, OTP-Policies, Revoke) testet
 * `src/server/auth/mfa-policy.test.ts`. HIER wird die GUARD-KETTE isoliert
 * geprüft; dafür werden Rolle/MFA-Flags direkt im Memory-Store gesetzt (über
 * die HTTP-API unmöglich: input:false). Wichtig: `twoFactorEnabled` wird erst
 * NACH dem Sign-in gesetzt, sonst würde der Plugin-after-Hook die Session
 * löschen und `twoFactorRedirect` liefern (genau das prüft der Lockdown-Test).
 */

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF"; // >= 32 Zeichen
const PASSWORD = "correct-horse-battery"; // >= 10 Zeichen (minPasswordLength)

const HOST_A = "tenant-a.hallofhelp.app";
const HOST_B = "tenant-b.hallofhelp.app";

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

type Row = Record<string, unknown>;
type MemoryDb = Record<string, Row[]>;

/**
 * App-Fixture: Test-Registry (t_a/t_b) als strict-Resolver-Fake (unbekannter
 * Host → null) + Memory-better-auth über GENAU dieselben Optionen wie die
 * Runtime (`tenantAuthOptions` inkl. basePath /api/v1/auth). Eine gemeinsame
 * DB pro Test — die Isolation muss vom tenantAwareAdapter kommen, nicht von
 * getrennten Stores.
 */
function makeApp() {
  // Store-Keys/Row-Spalten tragen das GEMAPPTE Naming der D1-Migrationen
  // (auth_*, snake_case) — die Adapter-Factory uebersetzt vor dem Store-Zugriff.
  const db: MemoryDb = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const deps: ApiDeps = {
    resolveTenant: async (host) => {
      const hostname = (host ?? "").split(":")[0].toLowerCase();
      return TENANTS[hostname] ?? null; // strict: kein Fallback
    },
    createAuthForTenant: async () =>
      buildAuth({ adapter: memoryAdapter(db)(tenantAuthOptions(TEST_SECRET)), secret: TEST_SECRET }),
    // Branding-/Team-Infrastruktur hier bewusst "nicht vorhanden" (fail-closed
    // 503); Verhaltensfälle testen app.branding.test.ts / app.team.test.ts.
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
  };
  return { app: buildApiApp(deps), db };
}

type TestApp = ReturnType<typeof makeApp>["app"];

function postJson(app: TestApp, path: string, host: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { host, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Legt per ECHTEM HTTP-Flow (Sign-up → Sign-in) eine Session an und liefert den
 * Cookie-Header. Rolle/MFA-Flags werden direkt im Store gesetzt (siehe oben) —
 * `twoFactorEnabled` bewusst erst NACH dem Sign-in, weil der Plugin-after-Hook
 * sonst (korrekt!) die Session löscht und `twoFactorRedirect` liefert.
 */
async function createSession(
  app: TestApp,
  db: MemoryDb,
  host: string,
  email: string,
  opts: { role?: string; twoFactorEnabled?: boolean; mfaVerified?: boolean } = {},
): Promise<string> {
  const tenantId = TENANTS[host].id;

  const signUp = await postJson(app, `${AUTH_BASE_PATH}/sign-up/email`, host, {
    email,
    password: PASSWORD,
    name: "Test",
  });
  expect(signUp.status).toBe(200);

  const user = db.auth_user.find((u) => u.email === email && u.tenant_id === tenantId);
  expect(user).toBeTruthy();
  // requireEmailVerification: für den Sign-in als verifiziert markieren.
  user!.email_verified = true;
  if (opts.role) user!.role = opts.role;

  const signIn = await postJson(app, `${AUTH_BASE_PATH}/sign-in/email`, host, {
    email,
    password: PASSWORD,
  });
  expect(signIn.status).toBe(200);

  // MFA-Zustand als Fixture NACH dem Sign-in (Guard-Ketten-Simulation).
  if (opts.twoFactorEnabled) user!.two_factor_enabled = true;
  if (opts.mfaVerified) {
    const session = db.auth_session.filter((s) => s.user_id === user!.id).at(-1);
    expect(session).toBeTruthy();
    session!.mfa_verified = true;
  }

  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect(cookie).toContain("session_token");
  return cookie;
}

describe("(a) better-auth-HTTP-Mount + Tenant-Isolation end-to-end", () => {
  it("POST /api/v1/auth/sign-up/email legt den User im Host-Tenant an (ALS-Boundary trägt bis in den Adapter)", async () => {
    const { app, db } = makeApp();

    const res = await postJson(app, `${AUTH_BASE_PATH}/sign-up/email`, HOST_A, {
      email: "alice@example.com",
      password: PASSWORD,
      name: "Alice",
    });
    expect(res.status).toBe(200);

    const users = db.auth_user.filter((u) => u.email === "alice@example.com");
    expect(users).toHaveLength(1);
    expect(users[0].tenant_id).toBe("t_a");
  });

  it("derselbe Sign-up (gleiche E-Mail) auf tenant-b funktioniert ebenfalls → getrennte Accounts pro Tenant", async () => {
    const { app, db } = makeApp();
    const body = { email: "same@example.com", password: PASSWORD, name: "Same" };

    const resA = await postJson(app, `${AUTH_BASE_PATH}/sign-up/email`, HOST_A, body);
    const resB = await postJson(app, `${AUTH_BASE_PATH}/sign-up/email`, HOST_B, body);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const users = db.auth_user.filter((u) => u.email === "same@example.com");
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.tenant_id).sort()).toEqual(["t_a", "t_b"]);
  });

  it("eine Session aus tenant-a gilt auf tenant-b NICHT (401)", async () => {
    const { app, db } = makeApp();
    const cookie = await createSession(app, db, HOST_A, "hopper@example.com");

    const sameTenant = await app.request("/api/v1/does-not-exist", {
      headers: { host: HOST_A, cookie },
    });
    // gültige Session im eigenen Tenant: Default-Deny passiert, dann sauberes 404
    expect(sameTenant.status).toBe(404);

    const crossTenant = await app.request("/api/v1/does-not-exist", {
      headers: { host: HOST_B, cookie },
    });
    expect(crossTenant.status).toBe(401);
  });
});

describe("(b) geschützte Route ohne Session", () => {
  it("GET /api/v1/admin/ping ohne Session → 401 unauthorized", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/v1/admin/ping", { headers: { host: HOST_A } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });
});

describe("(c) Guard-Kette: MFA-Gate vor Rollen-Check (exakte Reihenfolge)", () => {
  it("Team-Rolle (admin) OHNE MFA-Setup → ERST 403 mfa_setup_required (das MFA-Gate greift vor allem anderen)", async () => {
    const { app, db } = makeApp();
    const cookie = await createSession(app, db, HOST_A, "admin@example.com", { role: "admin" });

    const res = await app.request("/api/v1/admin/ping", { headers: { host: HOST_A, cookie } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "mfa_setup_required" });
  });

  it("gültige Session mit user.role='user' → 403-Kette (MFA-Gate greift vor dem Rollen-Check)", async () => {
    const { app, db } = makeApp();
    const cookie = await createSession(app, db, HOST_A, "user@example.com", { role: "user" });

    const res = await app.request("/api/v1/admin/ping", { headers: { host: HOST_A, cookie } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "mfa_setup_required" });
  });

  it("PHASE-C-LOCKDOWN: owner mit twoFactorEnabled=1 im Store bekommt per Passwort-Login KEINE nutzbare Session (twoFactorRedirect, Session gelöscht)", async () => {
    const { app, db } = makeApp();

    // Flags VOR dem Sign-in manipuliert: owner + 2FA "an" ohne echtes Verify.
    const signUp = await postJson(app, `${AUTH_BASE_PATH}/sign-up/email`, HOST_A, {
      email: "owner@example.com",
      password: PASSWORD,
      name: "Owner",
    });
    expect(signUp.status).toBe(200);
    const user = db.auth_user.find((u) => u.email === "owner@example.com" && u.tenant_id === "t_a")!;
    user.email_verified = true;
    user.role = "owner";
    user.two_factor_enabled = true;

    const signIn = await postJson(app, `${AUTH_BASE_PATH}/sign-in/email`, HOST_A, {
      email: "owner@example.com",
      password: PASSWORD,
    });
    expect(signIn.status).toBe(200);
    // Das echte Plugin löscht die Credential-Session und fordert den 2. Faktor.
    expect(await signIn.json()).toMatchObject({ twoFactorRedirect: true });
    expect(db.auth_session.filter((s) => s.user_id === user.id)).toHaveLength(0);

    // Auch mit allen zurückgegebenen Cookies (nur 2FA-Challenge-Cookie, keine
    // Session) bleibt die Team-Route zu.
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const res = await app.request("/api/v1/admin/ping", { headers: { host: HOST_A, cookie } });
    expect(res.status).toBe(401);
  });

  // Ab hier: Guard-Ketten-Tests mit Store-Fixtures (Flags NACH Sign-in gesetzt),
  // um die TIEFEREN Glieder der Kette isoliert zu beweisen. Die echten
  // MFA-Flows (Enrollment/Verify) laufen in src/server/auth/mfa-policy.test.ts.

  it("Team-Rolle mit MFA-Setup, aber unverifizierter Session → 403 mfa_verification_required", async () => {
    const { app, db } = makeApp();
    const cookie = await createSession(app, db, HOST_A, "admin2@example.com", {
      role: "admin",
      twoFactorEnabled: true,
    });

    const res = await app.request("/api/v1/admin/ping", { headers: { host: HOST_A, cookie } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "mfa_verification_required" });
  });

  it("user.role='user' trotz erfülltem MFA → 403 forbidden (Rollen-Check als letztes Gate)", async () => {
    const { app, db } = makeApp();
    const cookie = await createSession(app, db, HOST_A, "user2@example.com", {
      role: "user",
      twoFactorEnabled: true,
      mfaVerified: true,
    });

    const res = await app.request("/api/v1/admin/ping", { headers: { host: HOST_A, cookie } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden" });
  });

  it("role='content' (Team, aber < admin) → 403 forbidden; role='owner' (> admin) → 200", async () => {
    const { app, db } = makeApp();

    const content = await createSession(app, db, HOST_A, "content@example.com", {
      role: "content",
      twoFactorEnabled: true,
      mfaVerified: true,
    });
    const denied = await app.request("/api/v1/admin/ping", {
      headers: { host: HOST_A, cookie: content },
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "forbidden" });

    const owner = await createSession(app, db, HOST_A, "owner@example.com", {
      role: "owner",
      twoFactorEnabled: true,
      mfaVerified: true,
    });
    const allowed = await app.request("/api/v1/admin/ping", {
      headers: { host: HOST_A, cookie: owner },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ pong: true, tenantId: "t_a" });
  });

  it("unbekannte Rolle im Store → 403 forbidden (rank fail-closed)", async () => {
    const { app, db } = makeApp();
    const cookie = await createSession(app, db, HOST_A, "weird@example.com", {
      role: "superadmin", // nicht Teil des Rollenmodells
      twoFactorEnabled: true,
      mfaVerified: true,
    });

    const res = await app.request("/api/v1/admin/ping", { headers: { host: HOST_A, cookie } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden" });
  });
});

describe("(d) strict-Tenant-Auflösung fail-closed", () => {
  it("unbekannter Host → 404 unknown_tenant (kein Demo-Fallback), auch für Auth-Routen", async () => {
    const { app } = makeApp();

    const tenant = await app.request("/api/v1/tenant", {
      headers: { host: "spoofed.example.com" },
    });
    expect(tenant.status).toBe(404);
    expect(await tenant.json()).toMatchObject({ error: "unknown_tenant" });

    const auth = await postJson(app, `${AUTH_BASE_PATH}/sign-up/email`, "spoofed.example.com", {
      email: "x@example.com",
      password: PASSWORD,
      name: "X",
    });
    expect(auth.status).toBe(404);
  });

  it("/health bleibt als Liveness-Endpoint von der Tenant-Auflösung unabhängig", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/v1/health", {
      headers: { host: "spoofed.example.com" },
    });
    expect(res.status).toBe(200);
  });
});

describe("(e) Default-Deny: Routen-Enumeration + PUBLIC-Allowlist", () => {
  it("JEDE registrierte Route ist entweder public oder liefert ohne Session 401", async () => {
    const { app } = makeApp();

    // Hono registriert Middleware als method "ALL"; echte Endpunkte haben
    // konkrete Methoden. Guard-Middleware an Routen erzeugt Duplikate → dedupen.
    const endpoints = new Map<string, { method: string; path: string }>();
    for (const r of app.routes) {
      if (r.method === "ALL") continue;
      endpoints.set(`${r.method} ${r.path}`, { method: r.method, path: r.path });
    }
    expect(endpoints.size).toBeGreaterThan(0);

    for (const { method, path } of endpoints.values()) {
      // Routen tragen den basePath — sonst wäre die Allowlist-Prüfung sinnlos.
      expect(path.startsWith("/api/v1")).toBe(true);

      const probePath = path.replace("*", "enumeration-probe");
      if (isPublicPath(probePath)) continue;

      const res = await app.request(probePath, { method, headers: { host: HOST_A } });
      expect(res.status, `${method} ${path} muss ohne Session 401 liefern`).toBe(401);
      expect(await res.json()).toMatchObject({ error: "unauthorized" });
    }
  });

  it("unbekannte Pfade: anonym 401 (kein Route-Probing), mit Session 404", async () => {
    const { app, db } = makeApp();

    const anonymous = await app.request("/api/v1/secret-admin-area", {
      headers: { host: HOST_A },
    });
    expect(anonymous.status).toBe(401);

    const cookie = await createSession(app, db, HOST_A, "probe@example.com");
    const authed = await app.request("/api/v1/secret-admin-area", {
      headers: { host: HOST_A, cookie },
    });
    expect(authed.status).toBe(404);
    expect(await authed.json()).toMatchObject({ error: "not_found" });
  });

  it("PUBLIC_ROUTES-Snapshot: jede Änderung an der Allowlist ist ein bewusster Test-Update", () => {
    expect(PUBLIC_ROUTES).toMatchInlineSnapshot(`
      {
        "exact": [
          "/api/v1/health",
          "/api/v1/tenant",
          "/api/v1/branding/logo",
        ],
        "prefixes": [
          "/api/v1/auth/",
          "/api/v1/legal/",
        ],
      }
    `);
  });
});
