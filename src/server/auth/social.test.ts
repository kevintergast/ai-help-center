import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { buildApiApp } from "@/server/api/app";
import type { ApiDeps } from "@/server/api/context";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "./auth";
import {
  createMemoryNonceStore,
  gatewayRedirectURI,
  OAUTH_GATEWAY_ORIGIN,
  verifyState,
} from "./oauth-gateway";
import { buildSocialProviders } from "./social";
import { runWithTenant } from "./tenant-context";

/**
 * PHASE E — Social Login (Google/Microsoft) mit GEMOCKTEN Providern.
 *
 * Der Provider-HTTP-Verkehr wird über better-auths eigene Options-Hooks
 * `verifyIdToken`/`getUserInfo` gemockt (idToken-Zweig von `/sign-in/social`)
 * — KEINE echten OAuth-Calls, KEINE echten Secrets. Alles läuft über die ECHTE
 * better-auth-Pipeline (Session-Erstellung, databaseHooks, tenantAwareAdapter).
 *
 * E3 Social = nur 1. Faktor: OAuth-Session hat mfaVerified=false ⇒ Team-Route
 *    403 (mfa-Kette); erst nach TOTP-Step-up 200.
 * E4 Isolation: gleicher Provider-Account in t_a und t_b ⇒ zwei getrennte
 *    auth_user/auth_account (je tenant_id), kein Identity-Bleed.
 * E5 Kein Account-Linking: Google-Login mit E-Mail eines bestehenden
 *    Passwort-Accounts ⇒ account_not_linked, keine zweite/gemergte Zeile.
 * E6 trustDevice via Social für Team-Rolle wirkungslos: Social-Session bleibt
 *    mfaVerified=false, hinterlassene Trust-Device-Records werden gelöscht.
 * Zusätzlich: Provider-Konfig (redirectURI→Gateway, minimale Scopes,
 *    Microsoft common, konditionale Registrierung).
 */

const SECRET = "test-only-secret-value-0123456789-ABCDEF";
const PASSWORD = "correct-horse-battery";

const HOST_A = "tenant-a.hallofhelp.com";
const HOST_B = "tenant-b.hallofhelp.com";

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

interface MockProfile {
  sub: string;
  email: string;
  emailVerified?: boolean;
  name?: string;
}

/**
 * MOCK-Provider: der id_token ist ein JSON-String des Profils. `verifyIdToken`
 * akzeptiert jeden parsebaren Token; `getUserInfo` liefert das Profil zurück —
 * exakt die Seams, die better-auths google()/microsoft() als Options-Hooks
 * lesen (verifiziert: core/social-providers/{google,microsoft-entra-id}.mjs).
 */
function providerMock() {
  return {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    verifyIdToken: async (token: string) => {
      try {
        JSON.parse(token);
        return true;
      } catch {
        return false;
      }
    },
    getUserInfo: async (token: { idToken?: string }) => {
      const p = JSON.parse(token.idToken ?? "{}") as MockProfile;
      return {
        user: {
          id: p.sub,
          email: p.email,
          emailVerified: p.emailVerified ?? true,
          name: p.name ?? "",
        },
        data: p,
      };
    },
  };
}

function makeApp() {
  const db: MemoryDb = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const socialProviders = { google: providerMock(), microsoft: providerMock() };
  // EINE geteilte Auth-Instanz + DB über beide Tenants: die Isolation muss vom
  // tenantAwareAdapter kommen (identisches Muster wie mfa-policy.test.ts).
  const auth = buildAuth({
    adapter: memoryAdapter(db)(tenantAuthOptions(SECRET, { socialProviders })),
    secret: SECRET,
    socialProviders,
  });
  const deps: ApiDeps = {
    resolveTenant: async (host) => TENANTS[(host ?? "").split(":")[0].toLowerCase()] ?? null,
    createAuthForTenant: async () => auth,
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
  };
  return { app: buildApiApp(deps), db, auth };
}

type Fixture = ReturnType<typeof makeApp>;
type TestApp = Fixture["app"];
type Jar = Map<string, string>;

function updateJar(jar: Jar, res: Response): void {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!value) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader(jar: Jar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function post(app: TestApp, jar: Jar, host: string, path: string, body: unknown) {
  const res = await app.request(`${AUTH_BASE_PATH}${path}`, {
    method: "POST",
    headers: { host, "content-type": "application/json", cookie: cookieHeader(jar) },
    body: JSON.stringify(body),
  });
  updateJar(jar, res);
  return res;
}

/** idToken-Direktlogin über den echten Endpunkt (Provider gemockt). */
async function socialLogin(
  app: TestApp,
  jar: Jar,
  host: string,
  profile: MockProfile,
  provider = "google",
) {
  return post(app, jar, host, "/sign-in/social", {
    provider,
    idToken: { token: JSON.stringify(profile) },
  });
}

async function adminPing(app: TestApp, jar: Jar, host = HOST_A) {
  return app.request("/api/v1/admin/ping", { headers: { host, cookie: cookieHeader(jar) } });
}

function hasSessionCookie(jar: Jar): boolean {
  return [...jar.keys()].some((k) => k.includes("session_token"));
}

// -- TOTP-Helfer (identisch zur mfa-policy.test.ts) --------------------------
function base32Decode(encoded: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of encoded.toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

async function totpCode(fx: Fixture, uriSecret: string): Promise<string> {
  const { code } = await (
    fx.auth.api as unknown as {
      generateTOTP: (args: { body: { secret: string } }) => Promise<{ code: string }>;
    }
  ).generateTOTP({ body: { secret: base32Decode(uriSecret) } });
  return code;
}

// --------------------------------------------------------------------------
// Provider-Konfiguration
// --------------------------------------------------------------------------

describe("Provider-Konfiguration (buildSocialProviders)", () => {
  it("google+microsoft: redirectURI zeigt auf den Gateway, minimale Scopes, Microsoft tenant=common", () => {
    const cfg = buildSocialProviders({
      google: { clientId: "g", clientSecret: "gs" },
      microsoft: { clientId: "m", clientSecret: "ms" },
    }) as Record<string, Record<string, unknown>>;

    expect(cfg.google.redirectURI).toBe(`${OAUTH_GATEWAY_ORIGIN}/api/v1/auth/callback/google`);
    expect(cfg.google.disableDefaultScope).toBe(true);
    expect(cfg.google.scope).toEqual(["openid", "email", "profile"]);

    expect(cfg.microsoft.redirectURI).toBe(`${OAUTH_GATEWAY_ORIGIN}/api/v1/auth/callback/microsoft`);
    expect(cfg.microsoft.tenantId).toBe("common");
    expect(cfg.microsoft.scope).toEqual(["openid", "email", "profile"]);
  });

  it("fehlt ein Key-Paar, wird der Provider NICHT registriert (kein Crash)", () => {
    // Google vollständig, Microsoft ohne Secret → nur google.
    const cfg = buildSocialProviders({
      google: { clientId: "g", clientSecret: "gs" },
      microsoft: { clientId: "m" },
    }) as Record<string, unknown>;
    expect(Object.keys(cfg)).toEqual(["google"]);

    // Gar keine Credentials → undefined (kein leeres socialProviders-Objekt).
    expect(buildSocialProviders({ google: {}, microsoft: {} })).toBeUndefined();
    expect(buildSocialProviders(undefined)).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// E3 — Social = nur 1. Faktor
// --------------------------------------------------------------------------

describe("E3 — Social-Login ist nur der 1. Faktor (mfaVerified=false)", () => {
  it("admin per Social ⇒ Session mfaVerified=false ⇒ /admin/ping 403; nach TOTP-Step-up 200", async () => {
    const fx = makeApp();
    const email = "e3-admin@example.com";

    // (1) Erster Social-Login → User (role=user), Session mfaVerified=false.
    const jar0: Jar = new Map();
    const first = await socialLogin(fx.app, jar0, HOST_A, { sub: "g-e3", email });
    expect(first.status).toBe(200);
    const user = fx.db.auth_user.find((u) => u.email === email && u.tenant_id === "t_a")!;
    expect(user).toBeTruthy();
    const s0 = fx.db.auth_session.filter((s) => s.user_id === user.id).at(-1)!;
    expect(s0.mfa_verified).toBe(false); // Social erzeugt NIE einen verifizierten 2. Faktor

    // (2) TOTP in dieser Session enrollen (Social-User: kein Passwort nötig).
    const enable = await post(fx.app, jar0, HOST_A, "/two-factor/enable", {});
    expect(enable.status).toBe(200);
    const { totpURI } = (await enable.json()) as { totpURI: string };
    const secret = new URL(totpURI).searchParams.get("secret")!;
    const enrollVerify = await post(fx.app, jar0, HOST_A, "/two-factor/verify-totp", {
      code: await totpCode(fx, secret),
    });
    expect(enrollVerify.status).toBe(200);
    expect(user.two_factor_enabled).toBe(true);

    // (3) Zur Team-Rolle machen (Fixture — role ist input:false).
    user.role = "admin";

    // (4) FRISCHER Social-Login: trotz 2FA-Enrollment ist die Social-Session
    //     mfaVerified=false (Social ist kein 2.-Faktor-Verify).
    const jar: Jar = new Map();
    const relog = await socialLogin(fx.app, jar, HOST_A, { sub: "g-e3", email });
    expect(relog.status).toBe(200);
    const s1 = fx.db.auth_session.filter((s) => s.user_id === user.id).at(-1)!;
    expect(s1.mfa_verified).toBe(false);

    // (5) requireTeam blockt: 2FA eingerichtet, aber Session unverifiziert.
    const blocked = await adminPing(fx.app, jar);
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: "mfa_verification_required" });

    // (6) TOTP-Step-up in der Social-Session ⇒ mfaVerified=true ⇒ 200.
    const stepUp = await post(fx.app, jar, HOST_A, "/two-factor/verify-totp", {
      code: await totpCode(fx, secret),
    });
    expect(stepUp.status).toBe(200);
    const allowed = await adminPing(fx.app, jar);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ pong: true, tenantId: "t_a" });
  });
});

// --------------------------------------------------------------------------
// E4 — Tenant-Isolation
// --------------------------------------------------------------------------

describe("E4 — gleicher Provider-Account in t_a und t_b ⇒ getrennte User/Accounts", () => {
  it("kein Cross-Tenant-Identity-Bleed", async () => {
    const fx = makeApp();
    const profile: MockProfile = { sub: "shared-google-id", email: "shared@example.com" };

    const rA = await socialLogin(fx.app, new Map(), HOST_A, profile);
    const rB = await socialLogin(fx.app, new Map(), HOST_B, profile);
    expect(rA.status).toBe(200);
    expect(rB.status).toBe(200);

    // Zwei getrennte User-Zeilen, je Tenant.
    const users = fx.db.auth_user.filter((u) => u.email === "shared@example.com");
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.tenant_id).sort()).toEqual(["t_a", "t_b"]);

    // Zwei getrennte Account-Zeilen (gleiche account_id/provider_id, andere tenant_id).
    const accounts = fx.db.auth_account.filter(
      (a) => a.provider_id === "google" && a.account_id === "shared-google-id",
    );
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.tenant_id).sort()).toEqual(["t_a", "t_b"]);

    // Cross-Tenant nicht lesbar: t_a-Account im Kontext t_b unsichtbar.
    const ctx = await fx.auth.$context;
    const aInB = await runWithTenant("t_b", () =>
      ctx.adapter.findOne({
        model: "account",
        where: [
          { field: "providerId", value: "google" },
          { field: "accountId", value: "shared-google-id" },
          { field: "tenantId", value: "t_a" },
        ],
      }),
    );
    expect(aInB).toBeNull();
  });
});

// --------------------------------------------------------------------------
// E5 — Kein Account-Linking (account_not_linked)
// --------------------------------------------------------------------------

describe("E5 — kein Auto-Link Social↔Passwort im selben Tenant", () => {
  it("Google-Login auf E-Mail eines bestehenden Passwort-Accounts ⇒ account_not_linked, keine zweite Zeile", async () => {
    const fx = makeApp();
    const email = "e5@example.com";

    // Passwort-User anlegen (verifiziert).
    const signUp = await post(fx.app, new Map(), HOST_A, "/sign-up/email", {
      email,
      password: PASSWORD,
      name: "Pw",
    });
    expect(signUp.status).toBe(200);
    const pwUser = fx.db.auth_user.find((u) => u.email === email && u.tenant_id === "t_a")!;
    pwUser.email_verified = true;
    const usersBefore = fx.db.auth_user.filter((u) => u.email === email).length;

    // Social-Login mit derselben E-Mail (anderer Identitätsanbieter).
    const res = await socialLogin(fx.app, new Map(), HOST_A, { sub: "g-e5", email });

    // idToken-Zweig wirft OAUTH_LINK_ERROR mit Nachricht "account not linked".
    // (Der Authorization-Code-Zweig liefert error=account_not_linked im
    // Redirect — verifiziert in callback.mjs: result.error.split(" ").join("_").)
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message?: string; code?: string };
    expect(`${body.message ?? ""} ${body.code ?? ""}`.toLowerCase()).toContain("account not linked");

    // KEINE zweite User-Zeile, KEIN Google-Account.
    expect(fx.db.auth_user.filter((u) => u.email === email)).toHaveLength(usersBefore);
    expect(fx.db.auth_account.filter((a) => a.provider_id === "google")).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// E6 — trustDevice via Social wirkungslos + Trust-Records gelöscht
// --------------------------------------------------------------------------

describe("E6 — Social für Team-Rolle: kein Trust-Device-Bypass", () => {
  it("Social-Session bleibt mfaVerified=false und hinterlassene trust-device-Records werden gelöscht", async () => {
    const fx = makeApp();
    const email = "e6-admin@example.com";

    // Team-User via Social anlegen + zur Team-Rolle machen.
    const jar0: Jar = new Map();
    const first = await socialLogin(fx.app, jar0, HOST_A, { sub: "g-e6", email });
    expect(first.status).toBe(200);
    const user = fx.db.auth_user.find((u) => u.email === email && u.tenant_id === "t_a")!;
    user.role = "admin";

    // Einen (hypothetisch übrig gebliebenen) Trust-Device-Record für den User
    // hinterlegen — so als hätte er als role=user ein Gerät „vertraut".
    fx.db.auth_verification.push({
      id: "tv-seed",
      tenant_id: "t_a",
      identifier: "trust-device-seed",
      value: user.id,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    });

    // Frischer Social-Login als Team-User ⇒ after-Hook löscht Trust-Records.
    const jar: Jar = new Map();
    const relog = await socialLogin(fx.app, jar, HOST_A, { sub: "g-e6", email });
    expect(relog.status).toBe(200);
    expect(hasSessionCookie(jar)).toBe(true);

    // Session bleibt unverifiziert (Social ≠ 2. Faktor).
    const s1 = fx.db.auth_session.filter((s) => s.user_id === user.id).at(-1)!;
    expect(s1.mfa_verified).toBe(false);

    // Trust-Device-Record wurde entwertet (kein 30-Tage-Bypass via Social).
    expect(fx.db.auth_verification.find((v) => v.identifier === "trust-device-seed")).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// E8 — Authorization-Code-Start: outbound-Leg (wrapAuthorizationURL) verdrahtet
// --------------------------------------------------------------------------

/** App-Fixture MIT konfiguriertem OAuth-Gateway (getSecret + Memory-Nonce-Store). */
function makeGatewayApp() {
  const db: MemoryDb = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const socialProviders = { google: providerMock() };
  const auth = buildAuth({
    adapter: memoryAdapter(db)(tenantAuthOptions(SECRET, { socialProviders })),
    secret: SECRET,
    socialProviders,
  });
  const nonceStore = createMemoryNonceStore();
  const deps: ApiDeps = {
    resolveTenant: async (host) => TENANTS[(host ?? "").split(":")[0].toLowerCase()] ?? null,
    createAuthForTenant: async () => auth,
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
    oauthGateway: { getSecret: async () => SECRET, nonceStore },
  };
  return { app: buildApiApp(deps), db, nonceStore };
}

describe("E8 — sign-in/social-Start wird in den Gateway-Umschlag gewickelt", () => {
  it("liefert eine gewrappte Authorization-URL; der Gateway packt genau better-auths inneren state wieder aus", async () => {
    const { app, db } = makeGatewayApp();

    // (1) Sign-in-Start auf dem TENANT-Host (Authorization-Code-Zweig: kein idToken).
    const start = await app.request(`${AUTH_BASE_PATH}/sign-in/social`, {
      method: "POST",
      headers: { host: HOST_A, "content-type": "application/json" },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "https://tenant-a.hallofhelp.com/dashboard",
      }),
    });
    expect(start.status).toBe(200);
    // Die tenant-seitige better-auth-state-Cookie (CSRF-Anker) MUSS die
    // Umschlag-Umschreibung überleben (Header-Copy inkl. aller Set-Cookie).
    expect(start.headers.getSetCookie().some((c) => c.includes("state"))).toBe(true);
    const { url } = (await start.json()) as { url: string };
    const authURL = new URL(url);

    // redirect_uri zeigt (via socialProviders.google.redirectURI) auf den Gateway.
    expect(authURL.searchParams.get("redirect_uri")).toBe(gatewayRedirectURI("google"));

    // Der äußere state ist der SIGNIERTE Umschlag (payload.signature), nicht der
    // rohe better-auth-state. Er verifiziert sauber und trägt Tenant + Origin.
    const wrappedState = authURL.searchParams.get("state")!;
    expect(wrappedState).toContain(".");
    // Der echte Nonce liegt im App-internen Store; hier verifizieren wir nur, dass
    // der äußere state korrekt für t_a/Origin signiert ist (Nonce-Replay: E1/E2).
    const verified = await verifyState(SECRET, wrappedState, {
      nonceStore: { issue: async () => {}, consume: async () => true },
    });
    expect(verified).toMatchObject({
      ok: true,
      tenantId: "t_a",
      initiatingOrigin: "https://tenant-a.hallofhelp.com",
    });
    const innerState = verified.ok ? verified.innerState : "";

    // Der innere state ist better-auths roher Wert — genau dieser wurde
    // tenant-seitig als verification-Zeile (CSRF-Anker) persistiert.
    expect(innerState).not.toContain(".");
    expect(db.auth_verification.some((v) => v.identifier === innerState)).toBe(true);

    // (2) Provider ruft den GATEWAY-Host mit dem gewrappten state zurück →
    //     302 auf die Tenant-Origin, state zurückgetauscht auf den inneren Wert.
    const gw = await app.request(
      `/api/v1/auth/callback/google?code=AUTH_CODE&state=${encodeURIComponent(wrappedState)}`,
      { headers: { host: "auth.hallofhelp.com" } },
    );
    expect(gw.status).toBe(302);
    const loc = new URL(gw.headers.get("location")!);
    expect(loc.origin).toBe("https://tenant-a.hallofhelp.com");
    expect(loc.pathname).toBe("/api/v1/auth/callback/google");
    expect(loc.searchParams.get("code")).toBe("AUTH_CODE");
    expect(loc.searchParams.get("state")).toBe(innerState);
  });

  it("idToken-Direktlogin trägt keine url ⇒ unverändert durchgereicht (Session erstellt)", async () => {
    const { app, db } = makeGatewayApp();
    const jar: Jar = new Map();
    const res = await socialLogin(app, jar, HOST_A, { sub: "g-e8", email: "e8@example.com" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url?: unknown; redirect?: unknown };
    expect(body.url).toBeFalsy();
    expect(body.redirect).toBe(false);
    expect(hasSessionCookie(jar)).toBe(true);
    expect(db.auth_user.some((u) => u.email === "e8@example.com" && u.tenant_id === "t_a")).toBe(true);
  });
});
