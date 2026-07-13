import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import type { BrandingRepository, LogoBucket } from "@/server/branding/store";
import type { BrandingColors } from "@/server/branding/validate";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";

/**
 * BRANDING-VERHALTEN end-to-end über `app.request()` — komplett mit Fakes
 * (Memory-Auth wie in app.security.test.ts, Map-basierte R2-/Repo-Fakes,
 * keine echten Bindings). Admin-Sessions durchlaufen die echte requireTeam-
 * Kette; die MFA-Flags werden als Store-Fixture NACH dem Sign-in gesetzt
 * (das echte two-factor-Plugin würde bei vorab gesetztem twoFactorEnabled
 * korrekt `twoFactorRedirect` liefern statt einer Session).
 */

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";
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

/** Map-basierter R2-Fake (nur der LogoBucket-Ausschnitt). */
class FakeBucket implements LogoBucket {
  readonly store = new Map<string, { bytes: Uint8Array; contentType?: string }>();

  async put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
    this.store.set(key, {
      bytes: new Uint8Array(value),
      contentType: options?.httpMetadata?.contentType,
    });
  }

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      body: new Blob([entry.bytes.slice()]).stream(),
      httpMetadata: { contentType: entry.contentType },
    };
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

/** Map-basierter Fake der Branding-Spalten (pro Tenant-ID). */
class FakeBrandingRepo implements BrandingRepository {
  readonly rows = new Map<string, { colors: BrandingColors | null; logoKey: string | null }>();

  private row(tenantId: string) {
    let r = this.rows.get(tenantId);
    if (!r) {
      r = { colors: null, logoKey: null };
      this.rows.set(tenantId, r);
    }
    return r;
  }

  async updateColors(tenantId: string, colors: BrandingColors) {
    this.row(tenantId).colors = colors;
  }
  async setLogoKey(tenantId: string, key: string) {
    this.row(tenantId).logoKey = key;
  }
  async clearLogoKey(tenantId: string) {
    this.row(tenantId).logoKey = null;
  }
  async getLogoKey(tenantId: string) {
    return this.rows.get(tenantId)?.logoKey ?? null;
  }
}

type MemoryDb = Record<string, Record<string, unknown>[]>;

/**
 * Fixture wie makeApp in app.security.test.ts (echtes two-factor-Plugin über
 * `tenantAuthOptions`) — PLUS injizierte Branding-Fakes.
 */
function makeApp(brandingAvailable = true) {
  // Store-Keys/Row-Spalten tragen das GEMAPPTE Naming der D1-Migrationen
  // (auth_*, snake_case) — die Adapter-Factory uebersetzt vor dem Store-Zugriff.
  const db: MemoryDb = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const bucket = new FakeBucket();
  const repo = new FakeBrandingRepo();

  const deps: ApiDeps = {
    resolveTenant: async (host) => {
      const hostname = (host ?? "").split(":")[0].toLowerCase();
      return TENANTS[hostname] ?? null;
    },
    createAuthForTenant: async () =>
      buildAuth({ adapter: memoryAdapter(db)(tenantAuthOptions(TEST_SECRET)), secret: TEST_SECRET }),
    getBrandingDeps: async () => (brandingAvailable ? { repo, bucket } : null),
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
  };
  return { app: buildApiApp(deps), db, bucket, repo };
}

type TestApp = ReturnType<typeof makeApp>["app"];

function postJson(app: TestApp, path: string, host: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { host, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Session per echtem Sign-up/Sign-in-Flow; Rolle/MFA-Flags direkt im Store. */
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
  expect(user).toBeTruthy();
  user!.email_verified = true;
  if (opts.role) user!.role = opts.role;

  const signIn = await postJson(app, `${AUTH_BASE_PATH}/sign-in/email`, host, {
    email,
    password: PASSWORD,
  });
  expect(signIn.status).toBe(200);

  // MFA-Flags erst NACH dem Sign-in (sonst greift die echte 2FA-Challenge).
  if (opts.mfa) {
    user!.two_factor_enabled = true;
    const session = db.auth_session.filter((s) => s.user_id === user!.id).at(-1);
    expect(session).toBeTruthy();
    session!.mfa_verified = true;
  }

  return signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const adminSession = (app: TestApp, db: MemoryDb, host: string) =>
  createSession(app, db, host, `admin-${host}@example.com`, { role: "admin", mfa: true });

const VALID_COLORS = { colorPrimary: "#e11d48", colorAccent: "#f59e0b", colorPrimaryFg: "#ffffff" };

// Kleinste sniff-bare Fixtures (Magic Bytes + Padding):
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);

function uploadLogo(app: TestApp, host: string, cookie: string, bytes: Uint8Array, contentType: string) {
  return app.request("/api/v1/admin/branding/logo", {
    method: "POST",
    headers: { host, cookie, "content-type": contentType },
    body: bytes.slice(),
  });
}

describe("PUT /api/v1/admin/branding (Farben, admin-gated, tenant-scoped)", () => {
  it("ohne Session → 401; mit Nicht-Admin-Rolle → 403 (Guard-Kette greift, nichts wird geschrieben)", async () => {
    const { app, db, repo } = makeApp();

    const anon = await app.request("/api/v1/admin/branding", {
      method: "PUT",
      headers: { host: HOST_A, "content-type": "application/json" },
      body: JSON.stringify(VALID_COLORS),
    });
    expect(anon.status).toBe(401);
    expect(await anon.json()).toMatchObject({ error: "unauthorized" });

    const userCookie = await createSession(app, db, HOST_A, "user@example.com", {
      role: "user",
      mfa: true,
    });
    const denied = await app.request("/api/v1/admin/branding", {
      method: "PUT",
      headers: { host: HOST_A, cookie: userCookie, "content-type": "application/json" },
      body: JSON.stringify(VALID_COLORS),
    });
    expect(denied.status).toBe(403);

    expect(repo.rows.size).toBe(0);
  });

  it("admin → 200; Farben landen NUR beim eigenen Tenant (Tenant B unverändert)", async () => {
    const { app, db, repo } = makeApp();
    const cookie = await adminSession(app, db, HOST_A);

    const res = await app.request("/api/v1/admin/branding", {
      method: "PUT",
      headers: { host: HOST_A, cookie, "content-type": "application/json" },
      body: JSON.stringify(VALID_COLORS),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, branding: VALID_COLORS });

    expect(repo.rows.get("t_a")?.colors).toEqual(VALID_COLORS);
    expect(repo.rows.get("t_b")).toBeUndefined();
  });

  it("ungültige Farbe (CSS-Injection-Payload) → 400 invalid_color, kein Schreibzugriff", async () => {
    const { app, db, repo } = makeApp();
    const cookie = await adminSession(app, db, HOST_A);

    const res = await app.request("/api/v1/admin/branding", {
      method: "PUT",
      headers: { host: HOST_A, cookie, "content-type": "application/json" },
      body: JSON.stringify({
        ...VALID_COLORS,
        colorPrimary: "red;}body{background:url(https://evil.example/x)}",
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_color" });
    expect(repo.rows.size).toBe(0);
  });

  it("kaputtes JSON → 400 invalid_json", async () => {
    const { app, db } = makeApp();
    const cookie = await adminSession(app, db, HOST_A);

    const res = await app.request("/api/v1/admin/branding", {
      method: "PUT",
      headers: { host: HOST_A, cookie, "content-type": "application/json" },
      body: "{nope",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_json" });
  });

  it("fehlende Bindings (D1/R2) → 503 branding_unavailable (fail-closed)", async () => {
    const { app, db } = makeApp(false);
    const cookie = await adminSession(app, db, HOST_A);

    const res = await app.request("/api/v1/admin/branding", {
      method: "PUT",
      headers: { host: HOST_A, cookie, "content-type": "application/json" },
      body: JSON.stringify(VALID_COLORS),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "branding_unavailable" });
  });
});

describe("POST /api/v1/admin/branding/logo (Upload-Härtung)", () => {
  it("SVG (Content-Type) → 415; PNG-Content-Type mit JPEG-Bytes → 400; > 1 MB → 413 — R2 bleibt leer", async () => {
    const { app, db, bucket } = makeApp();
    const cookie = await adminSession(app, db, HOST_A);

    const svg = await uploadLogo(
      app,
      HOST_A,
      cookie,
      new TextEncoder().encode("<svg/>"),
      "image/svg+xml",
    );
    expect(svg.status).toBe(415);
    expect(await svg.json()).toMatchObject({ error: "unsupported_media_type" });

    const lied = await uploadLogo(app, HOST_A, cookie, JPEG_BYTES, "image/png");
    expect(lied.status).toBe(400);
    expect(await lied.json()).toMatchObject({ error: "invalid_image" });

    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(PNG_BYTES);
    const tooBig = await uploadLogo(app, HOST_A, cookie, big, "image/png");
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toMatchObject({ error: "payload_too_large" });

    expect(bucket.store.size).toBe(0);
  });

  it("happy path: PNG landet unter tenants/<tid>/logo, GET liefert es public mit Cache-Headern; Tenant B → 404 (Cross-Tenant-Beweis)", async () => {
    const { app, db, bucket, repo } = makeApp();
    const cookie = await adminSession(app, db, HOST_A);

    const upload = await uploadLogo(app, HOST_A, cookie, PNG_BYTES, "image/png");
    expect(upload.status).toBe(200);

    expect([...bucket.store.keys()]).toEqual(["tenants/t_a/logo"]);
    expect(bucket.store.get("tenants/t_a/logo")?.contentType).toBe("image/png");
    expect(await repo.getLogoKey("t_a")).toBe("tenants/t_a/logo");

    // Public (OHNE Session, OHNE Cookie) auf Host A:
    const logo = await app.request("/api/v1/branding/logo?v=123", { headers: { host: HOST_A } });
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/png");
    expect(logo.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    // Polyglott-Schutz: Antwort darf nie als Dokument gesnifft werden.
    expect(logo.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await logo.arrayBuffer())).toEqual(PNG_BYTES);

    // Host B hat kein Logo → 404, obwohl das R2-Objekt von A existiert:
    const other = await app.request("/api/v1/branding/logo", { headers: { host: HOST_B } });
    expect(other.status).toBe(404);
    expect(await other.json()).toMatchObject({ error: "not_found" });
  });

  it("erneuter Upload überschreibt (fester Key, kein Objekt-Müll)", async () => {
    const { app, db, bucket } = makeApp();
    const cookie = await adminSession(app, db, HOST_A);

    expect((await uploadLogo(app, HOST_A, cookie, PNG_BYTES, "image/png")).status).toBe(200);
    expect((await uploadLogo(app, HOST_A, cookie, JPEG_BYTES, "image/jpeg")).status).toBe(200);

    expect(bucket.store.size).toBe(1);
    expect(bucket.store.get("tenants/t_a/logo")?.contentType).toBe("image/jpeg");
  });
});

describe("DELETE /api/v1/admin/branding/logo", () => {
  it("entfernt R2-Objekt + Key; GET danach 404", async () => {
    const { app, db, bucket, repo } = makeApp();
    const cookie = await adminSession(app, db, HOST_A);
    expect((await uploadLogo(app, HOST_A, cookie, PNG_BYTES, "image/png")).status).toBe(200);

    const del = await app.request("/api/v1/admin/branding/logo", {
      method: "DELETE",
      headers: { host: HOST_A, cookie },
    });
    expect(del.status).toBe(200);

    expect(bucket.store.size).toBe(0);
    expect(await repo.getLogoKey("t_a")).toBeNull();

    const logo = await app.request("/api/v1/branding/logo", { headers: { host: HOST_A } });
    expect(logo.status).toBe(404);
  });
});

describe("GET /api/v1/branding/logo (public)", () => {
  it("ohne Bindings → 503 fail-closed; unbekannter Host → 404 unknown_tenant", async () => {
    const { app } = makeApp(false);

    const res = await app.request("/api/v1/branding/logo", { headers: { host: HOST_A } });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "branding_unavailable" });

    const spoofed = await app.request("/api/v1/branding/logo", {
      headers: { host: "spoofed.example.com" },
    });
    expect(spoofed.status).toBe(404);
    expect(await spoofed.json()).toMatchObject({ error: "unknown_tenant" });
  });
});
