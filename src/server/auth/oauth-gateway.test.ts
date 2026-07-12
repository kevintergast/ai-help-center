import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { buildApiApp } from "@/server/api/app";
import type { ApiDeps } from "@/server/api/context";
import { buildAuth, tenantAuthOptions } from "./auth";
import {
  DEFAULT_STATE_TTL_MS,
  OAUTH_GATEWAY_ORIGIN,
  createMemoryNonceStore,
  gatewayRedirectURI,
  isAllowedInitiatingOrigin,
  signState,
  verifyState,
  wrapAuthorizationURL,
} from "./oauth-gateway";

/**
 * PHASE E — OAuth-Gateway.
 *
 * E1  state-Utility: sign→verify roundtrip; Tamper/expiry/replay/foreign-origin
 *     → reject (jeweils mit stabilem Grund).
 * E2  Gateway-Route (auf dem auth-Host, über den echten App-Mount):
 *     gültiger state ⇒ 302 auf korrekte Tenant-Origin mit ERHALTENER Query;
 *     ungültiger/fehlender state ⇒ 4xx, KEIN Redirect, KEIN DB-Insert;
 *     Nicht-Callback-Pfade auf dem auth-Host ⇒ 404 (kein Tenant).
 * E7  Der Gateway-Callback läuft VOR der Tenant-Middleware/Default-Deny — auf
 *     Tenant-Hosts fällt die Middleware durch (bestehende Routen unberührt).
 */

const SECRET = "test-only-secret-value-0123456789-ABCDEF";
const TENANT_A_ORIGIN = "https://tenant-a.hallofhelp.app";

// --------------------------------------------------------------------------
// E1 — state sign/verify
// --------------------------------------------------------------------------

describe("E1 — signState/verifyState", () => {
  it("roundtrip: gültiger state verifiziert und liefert Tenant, Origin, inneren state", async () => {
    const store = createMemoryNonceStore();
    await store.issue("t_a", "nonce-1");
    const token = await signState(SECRET, {
      tenantId: "t_a",
      initiatingOrigin: TENANT_A_ORIGIN,
      innerState: "inner-abc",
      nonce: "nonce-1",
    });
    const res = await verifyState(SECRET, token, { nonceStore: store });
    expect(res).toEqual({
      ok: true,
      tenantId: "t_a",
      initiatingOrigin: TENANT_A_ORIGIN,
      innerState: "inner-abc",
    });
  });

  it("Tamper am Payload ⇒ bad_signature (Nonce bleibt unverbraucht)", async () => {
    const store = createMemoryNonceStore();
    await store.issue("t_a", "nonce-2");
    const token = await signState(SECRET, {
      tenantId: "t_a",
      initiatingOrigin: TENANT_A_ORIGIN,
      innerState: "inner",
      nonce: "nonce-2",
    });
    // Signatur-Segment manipulieren (Payload bleibt valide) → Signatur passt
    // nicht. Erstes base64url-Zeichen kippen (volle 6-Bit-Gruppe → garantiert
    // andere Bytes; das LETZTE Zeichen trägt Padding-Bits und könnte identisch
    // dekodieren).
    const [payload, sig] = token.split(".");
    const flipped = `${payload}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
    const res = await verifyState(SECRET, flipped, { nonceStore: store });
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
    // Da die Signatur zuerst scheitert, wurde die Nonce NICHT verbraucht:
    const retryOk = await verifyState(SECRET, token, { nonceStore: store });
    expect(retryOk.ok).toBe(true);
  });

  it("fremder Tenant-Schlüssel ⇒ bad_signature (state aus t_a verifiziert nicht unter falschem Secret-Kontext)", async () => {
    const store = createMemoryNonceStore();
    await store.issue("t_a", "nonce-x");
    const token = await signState(SECRET, {
      tenantId: "t_a",
      initiatingOrigin: TENANT_A_ORIGIN,
      innerState: "inner",
      nonce: "nonce-x",
    });
    // Anderes Basis-Secret ⇒ anderer HKDF-Key ⇒ Signatur passt nicht.
    const res = await verifyState("a-totally-different-base-secret-000000", token, {
      nonceStore: store,
    });
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("abgelaufener state ⇒ expired", async () => {
    const store = createMemoryNonceStore();
    await store.issue("t_a", "nonce-3");
    const past = Date.now() - DEFAULT_STATE_TTL_MS - 1000;
    const token = await signState(SECRET, {
      tenantId: "t_a",
      initiatingOrigin: TENANT_A_ORIGIN,
      innerState: "inner",
      nonce: "nonce-3",
      now: past,
    });
    const res = await verifyState(SECRET, token, { nonceStore: store });
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("Replay ⇒ zweites Einlösen derselben Nonce wird abgelehnt", async () => {
    const store = createMemoryNonceStore();
    await store.issue("t_a", "nonce-4");
    const token = await signState(SECRET, {
      tenantId: "t_a",
      initiatingOrigin: TENANT_A_ORIGIN,
      innerState: "inner",
      nonce: "nonce-4",
    });
    const first = await verifyState(SECRET, token, { nonceStore: store });
    expect(first.ok).toBe(true);
    const second = await verifyState(SECRET, token, { nonceStore: store });
    expect(second).toEqual({ ok: false, reason: "replay" });
  });

  it("nie ausgestellte Nonce ⇒ replay (fail-closed)", async () => {
    const store = createMemoryNonceStore();
    const token = await signState(SECRET, {
      tenantId: "t_a",
      initiatingOrigin: TENANT_A_ORIGIN,
      innerState: "inner",
      nonce: "never-issued",
    });
    const res = await verifyState(SECRET, token, { nonceStore: store });
    expect(res).toEqual({ ok: false, reason: "replay" });
  });

  it("fremde initiatingOrigin ⇒ foreign_origin (Open-Redirect-Schutz)", async () => {
    const store = createMemoryNonceStore();
    await store.issue("t_a", "nonce-5");
    const token = await signState(SECRET, {
      tenantId: "t_a",
      initiatingOrigin: "https://evil.example.com",
      innerState: "inner",
      nonce: "nonce-5",
    });
    const res = await verifyState(SECRET, token, { nonceStore: store });
    expect(res).toEqual({ ok: false, reason: "foreign_origin" });
  });

  it("malformed token ⇒ malformed", async () => {
    const store = createMemoryNonceStore();
    expect(await verifyState(SECRET, "not-a-token", { nonceStore: store })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyState(SECRET, "abc.def", { nonceStore: store })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("isAllowedInitiatingOrigin: nur https://<slug>.hallofhelp.app, keine reservierten Slugs", () => {
    expect(isAllowedInitiatingOrigin("https://acme.hallofhelp.app")).toBe(true);
    expect(isAllowedInitiatingOrigin("https://auth.hallofhelp.app")).toBe(false);
    expect(isAllowedInitiatingOrigin("https://www.hallofhelp.app")).toBe(false);
    expect(isAllowedInitiatingOrigin("http://acme.hallofhelp.app")).toBe(false); // kein https
    expect(isAllowedInitiatingOrigin("https://acme.hallofhelp.app.evil.com")).toBe(false);
    expect(isAllowedInitiatingOrigin("https://evil.com")).toBe(false);
  });
});

// --------------------------------------------------------------------------
// wrapAuthorizationURL — Sign-in-Start-Umschlag (Integrationsbaustein)
// --------------------------------------------------------------------------

describe("wrapAuthorizationURL — Gateway-Umschlag um better-auths state", () => {
  it("ersetzt den state durch den signierten Umschlag; der Gateway packt genau den inneren state wieder aus", async () => {
    const store = createMemoryNonceStore();
    // Simuliert die von better-auth erzeugte Authorization-URL mit ihrem
    // zufälligen inneren state und der Gateway-redirect_uri.
    const inner = "better-auth-random-state-32chars";
    const authURL = `https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=${inner}&redirect_uri=${encodeURIComponent(gatewayRedirectURI("google"))}`;

    const wrapped = await wrapAuthorizationURL(authURL, {
      secret: SECRET,
      tenantId: "t_a",
      initiatingOrigin: TENANT_A_ORIGIN,
      nonceStore: store,
    });

    const wrappedState = new URL(wrapped).searchParams.get("state")!;
    expect(wrappedState).not.toBe(inner);

    // Der Gateway verifiziert den Umschlag und rekonstruiert den inneren state.
    const res = await verifyState(SECRET, wrappedState, { nonceStore: store });
    expect(res).toEqual({
      ok: true,
      tenantId: "t_a",
      initiatingOrigin: TENANT_A_ORIGIN,
      innerState: inner,
    });
  });
});

// --------------------------------------------------------------------------
// E2 / E7 — Gateway-Route über den echten App-Mount
// --------------------------------------------------------------------------

const GATEWAY_HOST = "auth.hallofhelp.app";

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
  "tenant-a.hallofhelp.app": makeTenant("t_a", "tenant-a"),
};

type Row = Record<string, unknown>;
type MemoryDb = Record<string, Row[]>;

function makeApp() {
  const db: MemoryDb = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const nonceStore = createMemoryNonceStore();
  const deps: ApiDeps = {
    resolveTenant: async (host) => TENANTS[(host ?? "").split(":")[0].toLowerCase()] ?? null,
    createAuthForTenant: async () =>
      buildAuth({ adapter: memoryAdapter(db)(tenantAuthOptions(SECRET)), secret: SECRET }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
    oauthGateway: { getSecret: async () => SECRET, nonceStore },
  };
  return { app: buildApiApp(deps), db, nonceStore };
}

async function gatewayGet(app: ReturnType<typeof makeApp>["app"], query: string) {
  return app.request(`/api/v1/auth/callback/google?${query}`, {
    headers: { host: GATEWAY_HOST },
  });
}

describe("E2 — Gateway-Route (302 auf Tenant-Origin, fail-closed sonst)", () => {
  it("gültiger state ⇒ 302 auf <tenant-origin>/api/v1/auth/callback/google mit erhaltener Query (state:=innerState)", async () => {
    const { app, db, nonceStore } = makeApp();
    await nonceStore.issue("t_a", "gw-nonce");
    const state = await signState(SECRET, {
      tenantId: "t_a",
      initiatingOrigin: TENANT_A_ORIGIN,
      innerState: "inner-xyz",
      nonce: "gw-nonce",
    });

    const res = await gatewayGet(app, `code=AUTH_CODE_123&state=${encodeURIComponent(state)}&scope=openid`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe(TENANT_A_ORIGIN);
    expect(loc.pathname).toBe("/api/v1/auth/callback/google");
    // Query erhalten, nur state ersetzt.
    expect(loc.searchParams.get("code")).toBe("AUTH_CODE_123");
    expect(loc.searchParams.get("scope")).toBe("openid");
    expect(loc.searchParams.get("state")).toBe("inner-xyz");
    // KEIN DB-Insert am Gateway.
    expect(db.auth_user).toHaveLength(0);
    expect(db.auth_account).toHaveLength(0);
    expect(db.auth_session).toHaveLength(0);
  });

  it("fehlender state ⇒ 400, kein Redirect, kein DB-Insert", async () => {
    const { app, db } = makeApp();
    const res = await gatewayGet(app, "code=abc");
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(db.auth_user).toHaveLength(0);
  });

  it("ungültiger state (bad_signature) ⇒ 400, kein Redirect", async () => {
    const { app } = makeApp();
    const res = await gatewayGet(app, "code=abc&state=garbage.signature");
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("Replay am Gateway ⇒ zweiter identischer Callback 403 (single-use)", async () => {
    const { app, nonceStore } = makeApp();
    await nonceStore.issue("t_a", "gw-once");
    const state = await signState(SECRET, {
      tenantId: "t_a",
      initiatingOrigin: TENANT_A_ORIGIN,
      innerState: "inner",
      nonce: "gw-once",
    });
    const q = `code=abc&state=${encodeURIComponent(state)}`;
    expect((await gatewayGet(app, q)).status).toBe(302);
    const replay = await gatewayGet(app, q);
    expect(replay.status).toBe(403);
    expect(replay.headers.get("location")).toBeNull();
  });

  it("Nicht-Callback-Pfad auf dem Gateway-Host ⇒ 404 (kein Tenant, keine Auth-Endpunkte)", async () => {
    const { app } = makeApp();
    const tenant = await app.request("/api/v1/tenant", { headers: { host: GATEWAY_HOST } });
    expect(tenant.status).toBe(404);
    const signup = await app.request("/api/v1/auth/sign-up/email", {
      method: "POST",
      headers: { host: GATEWAY_HOST, "content-type": "application/json" },
      body: JSON.stringify({ email: "x@example.com", password: "correct-horse-battery", name: "X" }),
    });
    expect(signup.status).toBe(404);
  });

  it("tenant_origin_mismatch: state.tid passt nicht zum Tenant der (aufgelösten) Origin ⇒ 403, kein Redirect", async () => {
    const nonceStore = createMemoryNonceStore();
    await nonceStore.issue("t_a", "gw-mismatch");
    // state ist gültig signiert für t_a, initiierende Origin ist aber tenant-b —
    // deren Resolver liefert t_b. tid (t_a) ≠ Origin-Tenant (t_b) ⇒ harter Reject.
    const state = await signState(SECRET, {
      tenantId: "t_a",
      initiatingOrigin: "https://tenant-b.hallofhelp.app",
      innerState: "inner",
      nonce: "gw-mismatch",
    });
    const deps: ApiDeps = {
      resolveTenant: async (host) => TENANTS[(host ?? "").split(":")[0].toLowerCase()] ?? null,
      createAuthForTenant: async () =>
        buildAuth({ adapter: memoryAdapter({})(tenantAuthOptions(SECRET)), secret: SECRET }),
      getBrandingDeps: async () => null,
      getTeamDeps: async () => null,
      getLegalDeps: async () => null,
      getContentDeps: async () => null,
      oauthGateway: {
        getSecret: async () => SECRET,
        nonceStore,
        resolveTenantIdByOrigin: async (origin) =>
          ({
            "https://tenant-a.hallofhelp.app": "t_a",
            "https://tenant-b.hallofhelp.app": "t_b",
          })[origin] ?? null,
      },
    };
    const app = buildApiApp(deps);
    const res = await app.request(`/api/v1/auth/callback/google?code=abc&state=${encodeURIComponent(state)}`, {
      headers: { host: GATEWAY_HOST },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual({ error: "invalid_state:tenant_origin_mismatch" });
  });

  it("unsupported provider ⇒ 400", async () => {
    const { app, nonceStore } = makeApp();
    await nonceStore.issue("t_a", "n");
    const state = await signState(SECRET, {
      tenantId: "t_a",
      initiatingOrigin: TENANT_A_ORIGIN,
      innerState: "i",
      nonce: "n",
    });
    const res = await app.request(`/api/v1/auth/callback/github?state=${encodeURIComponent(state)}`, {
      headers: { host: GATEWAY_HOST },
    });
    expect(res.status).toBe(400);
  });
});

describe("E7 — Gateway-Middleware ist host-diskriminiert (Tenant-Hosts unberührt)", () => {
  it("auf einem Tenant-Host läuft /api/v1/tenant normal (keine Gateway-Interception)", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/v1/tenant", {
      headers: { host: "tenant-a.hallofhelp.app" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "t_a", slug: "tenant-a" });
  });

  it("gatewayRedirectURI zeigt auf den zentralen Host", () => {
    expect(gatewayRedirectURI("google")).toBe(`${OAUTH_GATEWAY_ORIGIN}/api/v1/auth/callback/google`);
    expect(gatewayRedirectURI("microsoft")).toBe(
      `${OAUTH_GATEWAY_ORIGIN}/api/v1/auth/callback/microsoft`,
    );
  });
});
