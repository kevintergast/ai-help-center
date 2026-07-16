import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import type { OwnerSetupResult } from "@/server/operator/onboarding";
import type {
  CreateResult,
  HelpCenterSummary,
  NewHelpCenter,
  OperatorRepository,
} from "@/server/operator/repository";
import type { TurnstileVerify } from "@/server/security/turnstile";
import { buildApiApp } from "./app";
import type { ApiDeps, OperatorDeps } from "./context";
import { MAX_HELP_CENTERS_PER_ACCOUNT } from "./operator";

/**
 * OPERATOR-ONBOARDING end-to-end über `app.request()` (Muster: app.team.test.ts).
 * Komplett mit Fakes (Memory-Auth, Map-Operator-Repo, aufgezeichneter Owner-
 * Setup-Versand). Jeder Test verhindert einen benennbaren realen Fehlerfall:
 * Kontext-Gate (nur Operator-Host), Session-Pflicht, Verifikations-Gate,
 * Slug-Kollision, Cross-Operator-Isolation, getrennte Owner-/Operator-Konten.
 * Die D1-SQL-/DDL-Semantik beweist src/server/operator/repository.test.ts.
 */

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";
const PASSWORD = "correct-horse-battery";

const OPERATOR_HOST = "app.hallofhelp.com";
const CUSTOMER_HOST = "acme.hallofhelp.com";

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
  [OPERATOR_HOST]: makeTenant("t_operator", "app"),
  [CUSTOMER_HOST]: makeTenant("t_customer", "acme"),
};

type Row = Record<string, unknown>;
type MemoryDb = Record<string, Row[]>;

/** Map-Fake mit D1-naher Semantik (Slug-Kollision, operator-scoped Liste). */
class FakeOperatorRepo implements OperatorRepository {
  readonly created: NewHelpCenter[] = [];
  private readonly takenSlugs = new Set<string>(["app"]); // Operator-Slug ist belegt

  /** Liest die credential-Vorlage aus dem Memory-Auth-Store (wie D1-Impl). */
  constructor(private readonly authDb: MemoryDb) {}

  async isSlugTaken(slug: string): Promise<boolean> {
    return this.takenSlugs.has(slug);
  }

  async getOwnerCredentialTemplate(
    tenantId: string,
    userId: string,
  ): Promise<NewHelpCenter["ownerCredential"]> {
    const mine = this.authDb.auth_account.filter(
      (a) => a.tenant_id === tenantId && a.user_id === userId,
    );
    const credential = mine.find(
      (a) => a.provider_id === "credential" && typeof a.password === "string",
    );
    const socialAccounts = mine
      .filter((a) => a.provider_id !== "credential")
      .map((a) => ({ providerId: a.provider_id as string, accountId: a.account_id as string }));
    if (!credential && socialAccounts.length === 0) return null;
    const tf = this.authDb.auth_two_factor.find(
      (t) => t.tenant_id === tenantId && t.user_id === userId,
    );
    return {
      passwordHash: (credential?.password as string | undefined) ?? null,
      socialAccounts,
      twoFactor: tf
        ? { secret: tf.secret as string, backupCodes: tf.backup_codes as string }
        : null,
    };
  }
  async createHelpCenter(input: NewHelpCenter): Promise<CreateResult> {
    if (this.takenSlugs.has(input.slug)) return "slug_taken";
    this.takenSlugs.add(input.slug);
    this.created.push(input);
    return "created";
  }
  async listByOperator(operatorUserId: string): Promise<HelpCenterSummary[]> {
    return this.created
      .filter((c) => c.operatorUserId === operatorUserId)
      .map((c) => ({
        tenantId: c.tenantId,
        slug: c.slug,
        name: c.name,
        defaultLocale: c.defaultLocale,
        createdAt: 0,
      }));
  }
  async countByOperator(operatorUserId: string): Promise<number> {
    return this.created.filter((c) => c.operatorUserId === operatorUserId).length;
  }
}

function makeApp(
  opts: { operatorAvailable?: boolean; turnstile?: TurnstileVerify | null } = {},
) {
  // `turnstile` undefined → permissiver Fake (Bestands-Tests unberührt);
  // explizit `null` → Dep fehlt (App muss 503 fail-closed antworten).
  const { operatorAvailable = true, turnstile = async () => "ok" as const } = opts;
  const db: MemoryDb = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const repo = new FakeOperatorRepo(db);
  const setupCalls: { tenant: Tenant; ownerEmail: string }[] = [];

  const operator: OperatorDeps = {
    repo,
    sendOwnerSetup: async (input): Promise<OwnerSetupResult> => {
      setupCalls.push(input);
      return { sent: false, devLink: `https://${input.tenant.slug}.hallofhelp.com/setup#tok` };
    },
  };

  const deps: ApiDeps = {
    resolveTenant: async (host) => {
      const hostname = (host ?? "").split(":")[0].toLowerCase();
      return TENANTS[hostname] ?? null;
    },
    createAuthForTenant: async () =>
      buildAuth({ adapter: memoryAdapter(db)(tenantAuthOptions(TEST_SECRET)), secret: TEST_SECRET }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
    getOperatorDeps: async () => (operatorAvailable ? operator : null),
    ...(turnstile ? { verifyTurnstile: turnstile } : {}),
  };
  return { app: buildApiApp(deps), db, repo, setupCalls };
}

type Fixture = ReturnType<typeof makeApp>;
type TestApp = Fixture["app"];

function postJson(
  app: TestApp,
  path: string,
  host: string,
  body: unknown,
  cookie?: string,
  extraHeaders?: Record<string, string>,
) {
  return app.request(path, {
    method: "POST",
    headers: {
      host,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

/** Session per echtem Sign-up/Sign-in (Operator-Konto = role user, verifiziert). */
async function operatorSession(
  f: Fixture,
  host: string,
  email: string,
  opts: { verified?: boolean } = {},
): Promise<{ cookie: string; userId: string }> {
  const { verified = true } = opts;
  const tenantId = TENANTS[host].id;
  const signUp = await postJson(f.app, `${AUTH_BASE_PATH}/sign-up/email`, host, {
    email,
    password: PASSWORD,
    name: "Operator",
  });
  expect(signUp.status).toBe(200);
  const user = f.db.auth_user.find((u) => u.email === email && u.tenant_id === tenantId)!;
  // Für den Sign-in muss die E-Mail verifiziert sein (requireEmailVerification).
  user.email_verified = true;

  const signIn = await postJson(f.app, `${AUTH_BASE_PATH}/sign-in/email`, host, {
    email,
    password: PASSWORD,
  });
  expect(signIn.status).toBe(200);
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  // Verifikation ggf. NACH dem Sign-in wieder entziehen (simuliert einen
  // eingeloggten, aber noch nicht verifizierten Operator).
  if (!verified) user.email_verified = false;
  return { cookie, userId: user.id as string };
}

const create = (f: Fixture, cookie: string, body: unknown, host = OPERATOR_HOST) =>
  postJson(f.app, "/api/v1/operator/help-centers", host, body, cookie);

const validBody = { name: "Acme Support", slug: "acme", defaultLocale: "de" };

describe("GET /api/v1/operator/subdomain-available", () => {
  it("frei / belegt / reserviert / ungültiges Format (eingeloggter Operator)", async () => {
    const f = makeApp();
    const { cookie } = await operatorSession(f, OPERATOR_HOST, "op@example.com");
    const check = (slug: string) =>
      f.app.request(`/api/v1/operator/subdomain-available?slug=${encodeURIComponent(slug)}`, {
        headers: { host: OPERATOR_HOST, cookie },
      });

    expect(await (await check("brandnew")).json()).toEqual({ available: true });
    expect(await (await check("app")).json()).toMatchObject({ available: false, reason: "reserved" });
    expect(await (await check("auth")).json()).toMatchObject({ available: false, reason: "reserved" });
    expect(await (await check("NO_PE")).json()).toMatchObject({
      available: false,
      reason: "invalid_format",
    });

    // Nach einem Create ist der Slug belegt:
    await create(f, cookie, validBody);
    expect(await (await check("acme")).json()).toMatchObject({ available: false, reason: "taken" });
  });

  it("ohne Session → 401 (Default-Deny)", async () => {
    const f = makeApp();
    const res = await f.app.request("/api/v1/operator/subdomain-available?slug=acme", {
      headers: { host: OPERATOR_HOST },
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/operator/help-centers", () => {
  it("nicht eingeloggt → 401 (Route ist nicht public)", async () => {
    const f = makeApp();
    const res = await create(f, "", validBody);
    expect(res.status).toBe(401);
    expect(f.repo.created).toHaveLength(0);
  });

  it("erfolgreicher Create: Owner-Konto GETRENNT, startet aber mit KOPIERTEN Zugangsdaten (keine Setup-Mail)", async () => {
    const f = makeApp();
    const { cookie, userId } = await operatorSession(f, OPERATOR_HOST, "op@example.com");

    const res = await create(f, cookie, validBody);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      slug: "acme",
      name: "Acme Support",
      helpCenterUrl: "https://acme.hallofhelp.com",
      ownerAccess: "same_credentials",
    });
    // Mit kopierten Zugangsdaten gibt es KEINEN Setup-Link (auch nicht dev).
    expect(body.ownerSetupDevLink).toBeUndefined();

    // Provisioning: EIN Hilfezentrum, Mapping über die eigene Operator-Id.
    expect(f.repo.created).toHaveLength(1);
    const input = f.repo.created[0];
    expect(input.operatorUserId).toBe(userId);
    expect(input.ownerEmail).toBe("op@example.com");
    // Owner-Konto ist ein GETRENNTES Konto: eigener User im NEUEN Tenant,
    // NICHT das Operator-Konto (andere User-Id, anderer tenant_id ≠ t_operator).
    expect(input.ownerUserId).not.toBe(userId);
    expect(input.tenantId).not.toBe("t_operator");

    // Same-Credentials: der ECHTE Operator-Passwort-Hash wurde als Vorlage
    // durchgereicht (einmalige Kopie; keine Setup-Mail nötig).
    const operatorAccount = f.db.auth_account.find(
      (a) => a.user_id === userId && a.provider_id === "credential",
    )!;
    expect(input.ownerCredential?.passwordHash).toBe(operatorAccount.password);
    expect(f.setupCalls).toHaveLength(0);
  });

  it("SSO-Operator (nur Google): Google-VERKNÜPFUNG wird kopiert → same_credentials, KEINE Setup-Mail", async () => {
    const f = makeApp();
    const { cookie, userId } = await operatorSession(f, OPERATOR_HOST, "op@example.com");
    // Konto zu Social-only umbauen: credential weg, Google-Verknüpfung rein
    // (wie nach einem echten Google-Sign-up in t_operator).
    f.db.auth_account = f.db.auth_account.filter(
      (a) => !(a.user_id === userId && a.provider_id === "credential"),
    );
    f.db.auth_account.push({
      id: "acc-google",
      tenant_id: "t_operator",
      user_id: userId,
      provider_id: "google",
      account_id: "google-sub-4711",
    });

    const res = await create(f, cookie, validBody);
    expect(res.status).toBe(201);
    expect(((await res.json()) as Record<string, unknown>).ownerAccess).toBe("same_credentials");

    const copied = f.repo.created[0].ownerCredential;
    expect(copied).toEqual({
      passwordHash: null,
      socialAccounts: [{ providerId: "google", accountId: "google-sub-4711" }],
      twoFactor: null,
    });
    // Mit kopierter Login-Methode KEINE Setup-Mail.
    expect(f.setupCalls).toHaveLength(0);
  });

  it("Operator ohne JEDE kopierbare Login-Methode: Fallback auf Setup-Mail", async () => {
    const f = makeApp();
    const { cookie, userId } = await operatorSession(f, OPERATOR_HOST, "op@example.com");
    // Simuliert: credential-Eintrag verliert sein Passwort, keine Social-Verknüpfung.
    const account = f.db.auth_account.find(
      (a) => a.user_id === userId && a.provider_id === "credential",
    )!;
    delete account.password;

    const res = await create(f, cookie, validBody);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ownerAccess: "setup_mail",
      ownerSetupDevLink: "https://acme.hallofhelp.com/setup#tok",
    });
    expect(f.repo.created[0].ownerCredential).toBeNull();
    expect(f.setupCalls).toHaveLength(1);
    expect(f.setupCalls[0]).toMatchObject({ ownerEmail: "op@example.com" });
    expect(f.setupCalls[0].tenant.slug).toBe("acme");
  });

  it("nicht e-mail-verifizierter Operator → 403 operator_email_unverified (kein Provisioning)", async () => {
    const f = makeApp();
    const { cookie } = await operatorSession(f, OPERATOR_HOST, "op@example.com", { verified: false });
    const res = await create(f, cookie, validBody);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "operator_email_unverified" });
    expect(f.repo.created).toHaveLength(0);
  });

  it("doppelter Slug → 409 slug_taken", async () => {
    const f = makeApp();
    const { cookie } = await operatorSession(f, OPERATOR_HOST, "op@example.com");
    expect((await create(f, cookie, validBody)).status).toBe(201);
    const dup = await create(f, cookie, { ...validBody, name: "Second" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "slug_taken" });
    expect(f.repo.created).toHaveLength(1);
  });

  it("Abuse-Cap: ab dem 6. Hilfezentrum → 409 help_center_limit_reached (kein Provisioning)", async () => {
    const f = makeApp();
    const { cookie } = await operatorSession(f, OPERATOR_HOST, "op@example.com");
    for (let i = 0; i < MAX_HELP_CENTERS_PER_ACCOUNT; i++) {
      expect((await create(f, cookie, { ...validBody, slug: `firma-${i}` })).status).toBe(201);
    }
    const over = await create(f, cookie, { ...validBody, slug: "firma-zuviel" });
    expect(over.status).toBe(409);
    expect(await over.json()).toMatchObject({ error: "help_center_limit_reached" });
    expect(f.repo.created).toHaveLength(MAX_HELP_CENTERS_PER_ACCOUNT);

    // Der Deckel ist PRO KONTO: ein anderer Operator kann weiterhin erstellen.
    const other = await operatorSession(f, OPERATOR_HOST, "op2@example.com");
    expect((await create(f, other.cookie, { ...validBody, slug: "andere-firma" })).status).toBe(
      201,
    );
  });

  it("reservierter/ungültiger Slug → 400 invalid_slug (kein Kapern von app/auth/…)", async () => {
    const f = makeApp();
    const { cookie } = await operatorSession(f, OPERATOR_HOST, "op@example.com");
    expect((await create(f, cookie, { ...validBody, slug: "app" })).status).toBe(400);
    expect((await create(f, cookie, { ...validBody, slug: "NOPE" })).status).toBe(400);
    expect(f.repo.created).toHaveLength(0);
  });

  it("fehlende Operator-Bindings → 503 operator_unavailable (fail-closed)", async () => {
    const f = makeApp({ operatorAvailable: false });
    const { cookie } = await operatorSession(f, OPERATOR_HOST, "op@example.com");
    const res = await create(f, cookie, validBody);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "operator_unavailable" });
  });

  it("auf einem KUNDEN-Host existiert die Operator-Route nicht → 404 (Kontext-Gate)", async () => {
    const f = makeApp();
    const { cookie } = await operatorSession(f, CUSTOMER_HOST, "user@acme.example.com");
    const res = await create(f, cookie, validBody, CUSTOMER_HOST);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
    expect(f.repo.created).toHaveLength(0);
  });
});

describe("GET /api/v1/operator/help-centers (nur eigene)", () => {
  it("Operator B sieht die Hilfezentren von Operator A NICHT", async () => {
    const f = makeApp();
    const a = await operatorSession(f, OPERATOR_HOST, "a@example.com");
    const b = await operatorSession(f, OPERATOR_HOST, "b@example.com");

    expect((await create(f, a.cookie, { ...validBody, slug: "acme" })).status).toBe(201);
    expect((await create(f, a.cookie, { ...validBody, slug: "beta" })).status).toBe(201);
    expect((await create(f, b.cookie, { ...validBody, slug: "gamma" })).status).toBe(201);

    const listA = (await (
      await f.app.request("/api/v1/operator/help-centers", {
        headers: { host: OPERATOR_HOST, cookie: a.cookie },
      })
    ).json()) as { helpCenters: { slug: string }[] };
    expect(listA.helpCenters.map((h) => h.slug).sort()).toEqual(["acme", "beta"]);

    const listB = (await (
      await f.app.request("/api/v1/operator/help-centers", {
        headers: { host: OPERATOR_HOST, cookie: b.cookie },
      })
    ).json()) as { helpCenters: { slug: string }[] };
    expect(listB.helpCenters.map((h) => h.slug)).toEqual(["gamma"]);
  });
});

describe("POST /api/v1/operator/help-centers — Turnstile-Gate (Infra-Plan Schritt 2)", () => {
  it("ohne Token → 400 captcha_required; ungültiges Token → 403 captcha_failed", async () => {
    // Prüfer-Fake mit Prod-Semantik: Token Pflicht, nur "valid" besteht.
    const f = makeApp({
      turnstile: async (token) => (token ? (token === "valid" ? "ok" : "failed") : "missing"),
    });
    const { cookie } = await operatorSession(f, OPERATOR_HOST, "op@example.com");

    const missing = await create(f, cookie, validBody);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "captcha_required" });

    const failed = await postJson(
      f.app,
      "/api/v1/operator/help-centers",
      OPERATOR_HOST,
      validBody,
      cookie,
      { "x-captcha-response": "wrong" },
    );
    expect(failed.status).toBe(403);
    expect(await failed.json()).toEqual({ error: "captcha_failed" });
    // Kein Seiteneffekt: nichts provisioniert, kein Owner-Setup versandt.
    expect(f.setupCalls).toHaveLength(0);

    const ok = await postJson(
      f.app,
      "/api/v1/operator/help-centers",
      OPERATOR_HOST,
      validBody,
      cookie,
      { "x-captcha-response": "valid" },
    );
    expect(ok.status).toBe(201);
  });

  it("fehlender Prüfer (Dep nicht injiziert) → 503 fail-closed, NIE Bypass", async () => {
    const f = makeApp({ turnstile: null });
    const { cookie } = await operatorSession(f, OPERATOR_HOST, "op@example.com");
    const res = await create(f, cookie, validBody);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "captcha_unavailable" });
    expect(f.setupCalls).toHaveLength(0);
  });
});
