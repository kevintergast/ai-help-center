import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { buildApiApp } from "@/server/api/app";
import type { ApiDeps } from "@/server/api/context";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "./auth";
import { setPendingRole } from "./roles";
import { runWithTenant } from "./tenant-context";

/**
 * PHASE-C-INVARIANTEN (C1–C7) gegen die ECHTE better-auth-API (two-factor-
 * Plugin, memoryAdapter, HTTP-Flows über den echten App-Mount — keine Bindings,
 * keine Simulation der Plugin-Mechanik).
 *
 * C1 Enrollment: enable legt Secret an, twoFactorEnabled bleibt false bis verifyTotp.
 * C2 pending_role: Promotion NUR nach vollständigem TOTP-Enrollment; vorher
 *    blockiert requireTeam (mfa_setup_required) und role bleibt "user".
 * C3 Login mit 2FA: Passwort allein ⇒ keine nutzbare Session (twoFactorRedirect);
 *    nach verifyTotp ⇒ Session mit mfaVerified=true; admin/ping 200.
 * C4 Email-OTP: als 2. Faktor für content ok; für admin/owner 403 (stabiler Code).
 * C5 trustDevice: für Team-Rollen serverseitig neutralisiert (kein Trust-Record,
 *    kein Login-Skip); für role=user funktioniert die Mechanik — aber auch der
 *    Skip erzeugt NIE mfaVerified=true (Schärfe-Kontrolle).
 * C6 Tenant-Isolation: twoFactor-Zeile aus t_a ist in t_b unsichtbar; ein
 *    t_a-2FA-Challenge-Cookie ist im Kontext t_b wertlos.
 * C7 Revoke: MFA enable/disable widerruft alle ANDEREN Sessions des Users.
 * Zusätzlich: Step-up-Gate für /two-factor/disable (Team-Rollen) inkl.
 * Step-up-Refresh durch Re-Verify-TOTP.
 */

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";
const PASSWORD = "correct-horse-battery";

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
 * Fixture: EINE geteilte Auth-Instanz + EINE geteilte Memory-DB über beide
 * Tenants — die Isolation muss vom tenantAwareAdapter kommen. `otpOutbox`
 * fängt Email-OTPs über den echten `otpOptions.sendOTP`-Pfad ab.
 * Store-Keys/Row-Spalten tragen das GEMAPPTE Naming der D1-Migrationen
 * (auth_*, snake_case) — die Adapter-Factory uebersetzt vor dem Store-Zugriff.
 */
function makeApp() {
  const db: MemoryDb = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const otpOutbox: Array<{ email: string; otp: string }> = [];
  const auth = buildAuth({
    adapter: memoryAdapter(db)(tenantAuthOptions(TEST_SECRET)),
    secret: TEST_SECRET,
    sendOtpEmail: async ({ user, otp }) => {
      otpOutbox.push({ email: user.email, otp });
    },
  });
  const deps: ApiDeps = {
    resolveTenant: async (host) => {
      const hostname = (host ?? "").split(":")[0].toLowerCase();
      return TENANTS[hostname] ?? null;
    },
    createAuthForTenant: async () => auth,
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
  };
  return { app: buildApiApp(deps), db, auth, otpOutbox };
}

type Fixture = ReturnType<typeof makeApp>;
type TestApp = Fixture["app"];

/** Minimaler Cookie-Jar: Set-Cookie-Header einsammeln, Löschungen respektieren. */
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

function hasSessionCookie(jar: Jar): boolean {
  return [...jar.keys()].some((k) => k.includes("session_token"));
}

async function post(
  app: TestApp,
  jar: Jar,
  host: string,
  path: string,
  body: unknown,
): Promise<Response> {
  const res = await app.request(`${AUTH_BASE_PATH}${path}`, {
    method: "POST",
    headers: { host, "content-type": "application/json", cookie: cookieHeader(jar) },
    body: JSON.stringify(body),
  });
  updateJar(jar, res);
  return res;
}

async function adminPing(app: TestApp, jar: Jar, host = HOST_A): Promise<Response> {
  return await app.request("/api/v1/admin/ping", {
    headers: { host, cookie: cookieHeader(jar) },
  });
}

function findUser(db: MemoryDb, email: string, tenantId: string): Row {
  const user = db.auth_user.find((u) => u.email === email && u.tenant_id === tenantId);
  expect(user, `User ${email} in ${tenantId}`).toBeTruthy();
  return user!;
}

/** Sign-up über HTTP + emailVerified-Fixture (requireEmailVerification). */
async function signUp(
  fx: Fixture,
  host: string,
  email: string,
  opts: { role?: string } = {},
): Promise<Row> {
  const res = await post(fx.app, new Map(), host, "/sign-up/email", {
    email,
    password: PASSWORD,
    name: "Test",
  });
  expect(res.status).toBe(200);
  const user = findUser(fx.db, email, TENANTS[host].id);
  user.email_verified = true;
  if (opts.role) user.role = opts.role;
  return user;
}

async function signIn(fx: Fixture, jar: Jar, host: string, email: string): Promise<Response> {
  const res = await post(fx.app, jar, host, "/sign-in/email", { email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res;
}

/**
 * Base32-Decode (RFC 4648, ohne Padding): die otpauth-URI trägt das Secret
 * base32-KODIERT (verifiziert: @better-auth/utils dist/otp.mjs →
 * `base32.encode(secret,{padding:false})`), während `generateTOTP`/`verify`
 * mit dem ROH-Secret arbeiten — wie ein echter Authenticator dekodieren wir.
 */
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

/** Gültigen TOTP-Code über better-auths server-only `generateTOTP` erzeugen. */
async function totpCode(fx: Fixture, uriSecret: string): Promise<string> {
  const { code } = await (
    fx.auth.api as unknown as {
      generateTOTP: (args: { body: { secret: string } }) => Promise<{ code: string }>;
    }
  ).generateTOTP({ body: { secret: base32Decode(uriSecret) } });
  return code;
}

/**
 * Vollständiges TOTP-Enrollment über die echten Endpunkte:
 * enable (Secret) → verify-totp (Code) → twoFactorEnabled=true + Session-Rotation.
 * @returns das TOTP-Secret (für spätere Logins).
 */
async function enrollTotp(fx: Fixture, jar: Jar, host: string): Promise<string> {
  const enable = await post(fx.app, jar, host, "/two-factor/enable", { password: PASSWORD });
  expect(enable.status).toBe(200);
  const { totpURI } = (await enable.json()) as { totpURI: string };
  const secret = new URL(totpURI).searchParams.get("secret");
  expect(secret).toBeTruthy();
  const verify = await post(fx.app, jar, host, "/two-factor/verify-totp", {
    code: await totpCode(fx, secret!),
  });
  expect(verify.status).toBe(200);
  return secret!;
}

describe("C1 — Enrollment: enable erzeugt Secret, twoFactorEnabled erst nach verifyTotp", () => {
  it("enable → Secret-Zeile (verified=false, tenant-gebunden), Flag bleibt false; verifyTotp → Flag=true, verified=true", async () => {
    const fx = makeApp();
    const user = await signUp(fx, HOST_A, "c1@example.com");
    const jar: Jar = new Map();
    await signIn(fx, jar, HOST_A, "c1@example.com");

    const enable = await post(fx.app, jar, HOST_A, "/two-factor/enable", { password: PASSWORD });
    expect(enable.status).toBe(200);
    const { totpURI } = (await enable.json()) as { totpURI: string };
    const secret = new URL(totpURI).searchParams.get("secret")!;
    expect(secret.length).toBeGreaterThan(0);

    expect(fx.db.auth_two_factor).toHaveLength(1);
    const row = fx.db.auth_two_factor[0];
    expect(row.secret).toBeTruthy();
    expect(row.backup_codes).toBeTruthy();
    expect(row.verified).toBe(false); // skipVerificationOnEnable: false
    expect(row.tenant_id).toBe("t_a"); // tenantAwareAdapter injiziert
    expect(user.two_factor_enabled).toBe(false); // C1: bleibt aus bis verifyTotp

    const verify = await post(fx.app, jar, HOST_A, "/two-factor/verify-totp", {
      code: await totpCode(fx, secret),
    });
    expect(verify.status).toBe(200);
    expect(user.two_factor_enabled).toBe(true);
    expect(fx.db.auth_two_factor[0].verified).toBe(true);
  });
});

describe("C2 — pending_role: Promotion NUR nach vollständigem TOTP-Enrollment", () => {
  it("pending_role=admin: vor Enrollment role=user + mfa_setup_required; nach verifyTotp role=admin, pending_role=null, admin/ping 200", async () => {
    const fx = makeApp();
    const user = await signUp(fx, HOST_A, "c2@example.com");
    await runWithTenant("t_a", () => setPendingRole(fx.auth, user.id as string, "admin"));
    expect(user.pending_role).toBe("admin");
    expect(user.role).toBe("user"); // Zielrolle geparkt, NIE vorab aktiv

    const jar: Jar = new Map();
    await signIn(fx, jar, HOST_A, "c2@example.com");

    // VOR Enrollment: requireTeam blockiert mit mfa_setup_required.
    const before = await adminPing(fx.app, jar);
    expect(before.status).toBe(403);
    expect(await before.json()).toMatchObject({ error: "mfa_setup_required" });
    expect(user.role).toBe("user");

    await enrollTotp(fx, jar, HOST_A);

    // Promotion atomar im verifyTotp-Erfolgspfad:
    expect(user.role).toBe("admin");
    expect(user.pending_role).toBeNull();

    const after = await adminPing(fx.app, jar);
    expect(after.status).toBe(200);
    expect(await after.json()).toMatchObject({ pong: true, tenantId: "t_a" });
  });

  it("Email-OTP-Enrollment promotet NICHT (nur TOTP zählt als vollständiges Enrollment)", async () => {
    const fx = makeApp();
    const user = await signUp(fx, HOST_A, "c2b@example.com");
    await runWithTenant("t_a", () => setPendingRole(fx.auth, user.id as string, "content"));

    const jar: Jar = new Map();
    await signIn(fx, jar, HOST_A, "c2b@example.com");

    // Email-OTP-"Enrollment" mit bestehender Session (echte Plugin-Mechanik:
    // verify-otp flippt twoFactorEnabled auch ohne TOTP-Secret).
    const send = await post(fx.app, jar, HOST_A, "/two-factor/send-otp", {});
    expect(send.status).toBe(200);
    const { otp } = fx.otpOutbox.at(-1)!;
    const verify = await post(fx.app, jar, HOST_A, "/two-factor/verify-otp", { code: otp });
    expect(verify.status).toBe(200);

    expect(user.two_factor_enabled).toBe(true);
    // Aber: KEINE Promotion — Zielrolle bleibt geparkt (M-2/§d: TOTP Pflicht).
    expect(user.role).toBe("user");
    expect(user.pending_role).toBe("content");
  });
});

describe("C3 — Login mit twoFactorEnabled: Passwort allein ergibt keine nutzbare Session", () => {
  it("Sign-in ⇒ twoFactorRedirect ohne Session; verifyTotp ⇒ Session mit mfaVerified=true; admin/ping 200 für role=admin", async () => {
    const fx = makeApp();
    const user = await signUp(fx, HOST_A, "c3@example.com");
    await runWithTenant("t_a", () => setPendingRole(fx.auth, user.id as string, "admin"));
    const enrollJar: Jar = new Map();
    await signIn(fx, enrollJar, HOST_A, "c3@example.com");
    const secret = await enrollTotp(fx, enrollJar, HOST_A);
    expect(user.role).toBe("admin");

    // Frischer Login: Passwort allein ⇒ Redirect, KEINE Session.
    const jar: Jar = new Map();
    const si = await signIn(fx, jar, HOST_A, "c3@example.com");
    expect(await si.json()).toMatchObject({ twoFactorRedirect: true });
    expect(hasSessionCookie(jar)).toBe(false);
    const denied = await adminPing(fx.app, jar);
    expect(denied.status).toBe(401);

    // Zweitfaktor ⇒ Session mit gesetztem Marker.
    const verify = await post(fx.app, jar, HOST_A, "/two-factor/verify-totp", {
      code: await totpCode(fx, secret),
    });
    expect(verify.status).toBe(200);
    expect(hasSessionCookie(jar)).toBe(true);

    const session = fx.db.auth_session.filter((s) => s.user_id === user.id).at(-1)!;
    expect(session.mfa_verified).toBe(true);
    expect(typeof session.mfa_verified_at).toBe("number");

    const allowed = await adminPing(fx.app, jar);
    expect(allowed.status).toBe(200);
  });
});

describe("C4 — Email-OTP als 2. Faktor: content ja, admin/owner nein", () => {
  it("content: send-otp + verify-otp ⇒ Session mit mfaVerified=true", async () => {
    const fx = makeApp();
    const user = await signUp(fx, HOST_A, "c4-content@example.com", { role: "content" });
    const enrollJar: Jar = new Map();
    await signIn(fx, enrollJar, HOST_A, "c4-content@example.com");
    await enrollTotp(fx, enrollJar, HOST_A);

    const jar: Jar = new Map();
    const si = await signIn(fx, jar, HOST_A, "c4-content@example.com");
    expect(await si.json()).toMatchObject({ twoFactorRedirect: true });

    const send = await post(fx.app, jar, HOST_A, "/two-factor/send-otp", {});
    expect(send.status).toBe(200);
    const mail = fx.otpOutbox.at(-1)!;
    expect(mail.email).toBe("c4-content@example.com");

    const verify = await post(fx.app, jar, HOST_A, "/two-factor/verify-otp", { code: mail.otp });
    expect(verify.status).toBe(200);

    const session = fx.db.auth_session.filter((s) => s.user_id === user.id).at(-1)!;
    expect(session.mfa_verified).toBe(true);
  });

  it("admin: send-otp UND verify-otp ⇒ 403 otp_not_allowed_for_role, keine Session, mfaVerified bleibt false", async () => {
    const fx = makeApp();
    const user = await signUp(fx, HOST_A, "c4-admin@example.com", { role: "admin" });
    const enrollJar: Jar = new Map();
    await signIn(fx, enrollJar, HOST_A, "c4-admin@example.com");
    await enrollTotp(fx, enrollJar, HOST_A);
    // Enrollment-Session beiseite räumen, damit "keine Session" scharf prüfbar ist.
    fx.db.auth_session.length = 0;

    const jar: Jar = new Map();
    await signIn(fx, jar, HOST_A, "c4-admin@example.com");

    const send = await post(fx.app, jar, HOST_A, "/two-factor/send-otp", {});
    expect(send.status).toBe(403);
    expect(await send.json()).toMatchObject({ code: "otp_not_allowed_for_role" });

    const verify = await post(fx.app, jar, HOST_A, "/two-factor/verify-otp", { code: "000000" });
    expect(verify.status).toBe(403);
    expect(await verify.json()).toMatchObject({ code: "otp_not_allowed_for_role" });

    expect(fx.db.auth_session.filter((s) => s.user_id === user.id)).toHaveLength(0);
  });

  it("Backup-Code als 2. Faktor ist für admin ebenfalls 403 (M-4)", async () => {
    const fx = makeApp();
    await signUp(fx, HOST_A, "c4-backup@example.com", { role: "admin" });
    const enrollJar: Jar = new Map();
    await signIn(fx, enrollJar, HOST_A, "c4-backup@example.com");
    await enrollTotp(fx, enrollJar, HOST_A);

    const jar: Jar = new Map();
    await signIn(fx, jar, HOST_A, "c4-backup@example.com");
    const res = await post(fx.app, jar, HOST_A, "/two-factor/verify-backup-code", {
      code: "aaaaa-aaaaa",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "otp_not_allowed_for_role" });
  });
});

describe("C5 — trustDevice-Bypass für Team-Rollen ausgeschlossen", () => {
  it("admin: verify-totp mit trustDevice:true legt KEINEN Trust-Record an; nächster Login fordert wieder den 2. Faktor", async () => {
    const fx = makeApp();
    await signUp(fx, HOST_A, "c5-admin@example.com", { role: "admin" });
    const enrollJar: Jar = new Map();
    await signIn(fx, enrollJar, HOST_A, "c5-admin@example.com");
    const secret = await enrollTotp(fx, enrollJar, HOST_A);

    const jar: Jar = new Map();
    await signIn(fx, jar, HOST_A, "c5-admin@example.com");
    const verify = await post(fx.app, jar, HOST_A, "/two-factor/verify-totp", {
      code: await totpCode(fx, secret),
      trustDevice: true, // wird serverseitig neutralisiert
    });
    expect(verify.status).toBe(200);

    // Kein Trust-Record, kein trust_device-Cookie.
    const trustRecords = fx.db.auth_verification.filter((v) =>
      String(v.identifier ?? "").startsWith("trust-device-"),
    );
    expect(trustRecords).toHaveLength(0);
    expect([...jar.keys()].some((k) => k.includes("trust_device"))).toBe(false);

    // Nächster Login: KEIN Skip — wieder twoFactorRedirect, keine Session-Cookie.
    const jar2: Jar = new Map();
    const si2 = await signIn(fx, jar2, HOST_A, "c5-admin@example.com");
    expect(await si2.json()).toMatchObject({ twoFactorRedirect: true });
    expect(hasSessionCookie(jar2)).toBe(false);
  });

  it("Schärfe-Kontrolle role=user: Mechanik existiert (Trust-Record + Skip), aber auch der Skip ergibt NIE mfaVerified=true", async () => {
    const fx = makeApp();
    const user = await signUp(fx, HOST_A, "c5-user@example.com");
    const enrollJar: Jar = new Map();
    await signIn(fx, enrollJar, HOST_A, "c5-user@example.com");
    const secret = await enrollTotp(fx, enrollJar, HOST_A);

    const jar: Jar = new Map();
    await signIn(fx, jar, HOST_A, "c5-user@example.com");
    const verify = await post(fx.app, jar, HOST_A, "/two-factor/verify-totp", {
      code: await totpCode(fx, secret),
      trustDevice: true,
    });
    expect(verify.status).toBe(200);

    // Für role=user greift die Neutralisierung NICHT → Record existiert.
    const trustRecords = fx.db.auth_verification.filter((v) =>
      String(v.identifier ?? "").startsWith("trust-device-"),
    );
    expect(trustRecords).toHaveLength(1);

    // Skip beim nächsten Login: Session entsteht, ABER mfa_verified=false
    // (Marker nur bei echtem Verify-Event — M-3).
    const si2 = await signIn(fx, jar, HOST_A, "c5-user@example.com");
    const body = (await si2.json()) as Record<string, unknown>;
    expect(body.twoFactorRedirect).toBeUndefined(); // Skip hat gegriffen
    const session = fx.db.auth_session.filter((s) => s.user_id === user.id).at(-1)!;
    expect(session.mfa_verified).toBe(false);
  });
});

describe("C6 — Tenant-Isolation der 2FA-Artefakte", () => {
  it("twoFactor-Zeile aus t_a ist in t_b unsichtbar; t_a-Challenge-Cookie + gültiger Code scheitern im Kontext t_b", async () => {
    const fx = makeApp();
    const userA = await signUp(fx, HOST_A, "c6@example.com");
    await signUp(fx, HOST_B, "c6@example.com"); // gleiche E-Mail, anderer Tenant

    const enrollJar: Jar = new Map();
    await signIn(fx, enrollJar, HOST_A, "c6@example.com");
    const secret = await enrollTotp(fx, enrollJar, HOST_A);

    // Adapter-Ebene: Zeile nur im eigenen Tenant auffindbar.
    expect(fx.db.auth_two_factor).toHaveLength(1);
    expect(fx.db.auth_two_factor[0].tenant_id).toBe("t_a");
    const ctx = await fx.auth.$context;
    const userAId = userA.id as string;
    const inA = await runWithTenant("t_a", () =>
      ctx.adapter.findOne({ model: "twoFactor", where: [{ field: "userId", value: userAId }] }),
    );
    const inB = await runWithTenant("t_b", () =>
      ctx.adapter.findOne({ model: "twoFactor", where: [{ field: "userId", value: userAId }] }),
    );
    expect(inA).toBeTruthy();
    expect(inB).toBeNull();

    // HTTP-Ebene: 2FA-Challenge aus t_a (Cookie) ist unter t_b wertlos —
    // der Verification-Record ist tenant-gescopet, verify-totp lehnt ab.
    const jar: Jar = new Map();
    const si = await signIn(fx, jar, HOST_A, "c6@example.com");
    expect(await si.json()).toMatchObject({ twoFactorRedirect: true });

    const sessionsBefore = fx.db.auth_session.filter((s) => s.user_id === userA.id).length;
    const crossVerify = await post(fx.app, jar, HOST_B, "/two-factor/verify-totp", {
      code: await totpCode(fx, secret),
    });
    expect(crossVerify.status).toBe(401);
    // Kein neuer Login/Session-Erwerb über die Tenant-Grenze hinweg.
    expect(fx.db.auth_session.filter((s) => s.user_id === userA.id)).toHaveLength(sessionsBefore);
  });
});

describe("C7 — Session-Revoke bei MFA enable/disable", () => {
  it("Enrollment-Abschluss widerruft andere Sessions; die frisch rotierte bleibt gültig", async () => {
    const fx = makeApp();
    await signUp(fx, HOST_A, "c7@example.com");
    const jar1: Jar = new Map();
    const jar2: Jar = new Map();
    await signIn(fx, jar1, HOST_A, "c7@example.com");
    await signIn(fx, jar2, HOST_A, "c7@example.com");

    // Beide Sessions leben (403 = Session gültig, MFA-Gate greift — nicht 401).
    expect((await adminPing(fx.app, jar2)).status).toBe(403);

    await enrollTotp(fx, jar1, HOST_A);

    // Andere Session widerrufen ⇒ 401; eigene (rotierte) lebt weiter ⇒ 403
    // forbidden (role=user, MFA erfüllt — beweist gültige Session + Marker).
    const revoked = await adminPing(fx.app, jar2);
    expect(revoked.status).toBe(401);
    const own = await adminPing(fx.app, jar1);
    expect(own.status).toBe(403);
    expect(await own.json()).toMatchObject({ error: "forbidden" });
  });

  it("disable widerruft andere Sessions und entfernt Secret + Flag", async () => {
    const fx = makeApp();
    const user = await signUp(fx, HOST_A, "c7b@example.com");
    const jar1: Jar = new Map();
    await signIn(fx, jar1, HOST_A, "c7b@example.com");
    const secret = await enrollTotp(fx, jar1, HOST_A);

    // Zweite (voll verifizierte) Session anlegen.
    const jar2: Jar = new Map();
    await signIn(fx, jar2, HOST_A, "c7b@example.com");
    const v2 = await post(fx.app, jar2, HOST_A, "/two-factor/verify-totp", {
      code: await totpCode(fx, secret),
    });
    expect(v2.status).toBe(200);
    expect((await adminPing(fx.app, jar2)).status).toBe(403); // Session lebt

    // role=user: kein Step-up-Gate → disable mit Passwort.
    const disable = await post(fx.app, jar1, HOST_A, "/two-factor/disable", {
      password: PASSWORD,
    });
    expect(disable.status).toBe(200);

    expect(user.two_factor_enabled).toBe(false);
    expect(fx.db.auth_two_factor).toHaveLength(0);
    // Andere Session widerrufen; eigene rotierte Session lebt.
    expect((await adminPing(fx.app, jar2)).status).toBe(401);
    expect((await adminPing(fx.app, jar1)).status).toBe(403);
  });

  it("Team-Rolle: disable verlangt FRISCHES Step-up (mfa_stepup_required); Re-Verify-TOTP frischt auf", async () => {
    const fx = makeApp();
    const user = await signUp(fx, HOST_A, "c7c@example.com", { role: "admin" });
    const enrollJar: Jar = new Map();
    await signIn(fx, enrollJar, HOST_A, "c7c@example.com");
    const secret = await enrollTotp(fx, enrollJar, HOST_A);

    const jar: Jar = new Map();
    await signIn(fx, jar, HOST_A, "c7c@example.com");
    const verify = await post(fx.app, jar, HOST_A, "/two-factor/verify-totp", {
      code: await totpCode(fx, secret),
    });
    expect(verify.status).toBe(200);

    // Step-up künstlich veralten lassen (Session-Fixture).
    const session = fx.db.auth_session.filter((s) => s.user_id === user.id).at(-1)!;
    session.mfa_verified_at = Math.floor(Date.now() / 1000) - 3600;

    const stale = await post(fx.app, jar, HOST_A, "/two-factor/disable", { password: PASSWORD });
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ code: "mfa_stepup_required" });
    expect(user.two_factor_enabled).toBe(true); // nichts deaktiviert

    // Echtes Re-Verify in der BESTEHENDEN Session (Step-up) frischt den Marker.
    const stepUp = await post(fx.app, jar, HOST_A, "/two-factor/verify-totp", {
      code: await totpCode(fx, secret),
    });
    expect(stepUp.status).toBe(200);
    // Row nach dem Update frisch lesen (Adapter kann das Objekt ersetzen).
    const refreshed = fx.db.auth_session.filter((s) => s.user_id === user.id).at(-1)!;
    expect(
      Math.floor(Date.now() / 1000) - (refreshed.mfa_verified_at as number),
    ).toBeLessThanOrEqual(5);

    const fresh = await post(fx.app, jar, HOST_A, "/two-factor/disable", { password: PASSWORD });
    expect(fresh.status).toBe(200);
    expect(user.two_factor_enabled).toBe(false);
  });
});
