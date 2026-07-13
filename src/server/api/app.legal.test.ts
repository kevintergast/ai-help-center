import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import type { LegalDocRecord, LegalRepository } from "@/server/legal/store";
import type { LegalDocData, LegalDocType } from "@/server/legal/validate";
import { LEGAL_DOC_TYPES } from "@/server/legal/validate";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";

/**
 * LEGAL-DOCS end-to-end über `app.request()` — komplett mit Fakes (Memory-Auth
 * wie app.branding.test.ts, Map-basierter Legal-Repo-Fake, keine echten
 * Bindings). Sessions durchlaufen die echte requireOwner/requireTeam-Kette;
 * MFA-Flags werden als Store-Fixture NACH dem Sign-in gesetzt.
 *
 * Prüft: Rollen-Gating (owner-exklusive Pflege, admin darf nur lesen),
 * Validierung (Injection/Größe/Inkonsistenz), Tenant-Isolation,
 * öffentliches Lesen (inkl. „Script-Tag bleibt Text"), Nicht-Blockieren.
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

/** Map-basierter Legal-Repo-Fake, pro Tenant-ID getrennt (Isolationsbeweis). */
class FakeLegalRepo implements LegalRepository {
  readonly rows = new Map<string, Map<LegalDocType, LegalDocRecord>>();
  private clock = 1000;

  private tenant(tenantId: string) {
    let m = this.rows.get(tenantId);
    if (!m) {
      m = new Map();
      this.rows.set(tenantId, m);
    }
    return m;
  }

  async upsert(tenantId: string, docType: LegalDocType, data: LegalDocData) {
    this.tenant(tenantId).set(docType, { ...data, updatedAt: this.clock++ });
  }
  async remove(tenantId: string, docType: LegalDocType) {
    this.tenant(tenantId).delete(docType);
  }
  async get(tenantId: string, docType: LegalDocType) {
    return this.rows.get(tenantId)?.get(docType) ?? null;
  }
  async listStatus(tenantId: string) {
    const m = this.rows.get(tenantId);
    return LEGAL_DOC_TYPES.map((docType) => {
      const row = m?.get(docType);
      return {
        docType,
        present: !!row,
        mode: row?.mode ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }
}

type MemoryDb = Record<string, Record<string, unknown>[]>;

function makeApp(legalAvailable = true) {
  const db: MemoryDb = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const repo = new FakeLegalRepo();

  const deps: ApiDeps = {
    resolveTenant: async (host) => {
      const hostname = (host ?? "").split(":")[0].toLowerCase();
      return TENANTS[hostname] ?? null;
    },
    createAuthForTenant: async () =>
      buildAuth({ adapter: memoryAdapter(db)(tenantAuthOptions(TEST_SECRET)), secret: TEST_SECRET }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => (legalAvailable ? { repo } : null),
    getContentDeps: async () => null,
  };
  return { app: buildApiApp(deps), db, repo };
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

const sessionAs = (app: TestApp, db: MemoryDb, host: string, role: string) =>
  createSession(app, db, host, `${role}-${host}@example.com`, { role, mfa: true });

function putDoc(app: TestApp, host: string, cookie: string, docType: string, body: unknown) {
  return app.request(`/api/v1/admin/legal/${docType}`, {
    method: "PUT",
    headers: { host, cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const LINK_BODY = { mode: "link", url: "https://acme.example/impressum" };

describe("PUT /api/v1/admin/legal/:docType (owner-exklusive Pflege)", () => {
  it("ohne Session → 401; als admin (nicht owner) → 403; als owner → 200", async () => {
    const { app, db, repo } = makeApp();

    const anon = await app.request("/api/v1/admin/legal/imprint", {
      method: "PUT",
      headers: { host: HOST_A, "content-type": "application/json" },
      body: JSON.stringify(LINK_BODY),
    });
    expect(anon.status).toBe(401);

    const adminCookie = await sessionAs(app, db, HOST_A, "admin");
    const asAdmin = await putDoc(app, HOST_A, adminCookie, "imprint", LINK_BODY);
    expect(asAdmin.status).toBe(403);
    expect(await asAdmin.json()).toMatchObject({ error: "forbidden" });

    const ownerCookie = await sessionAs(app, db, HOST_A, "owner");
    const asOwner = await putDoc(app, HOST_A, ownerCookie, "imprint", LINK_BODY);
    expect(asOwner.status).toBe(200);
    expect(await asOwner.json()).toMatchObject({ ok: true, docType: "imprint", mode: "link" });

    // Nichts geschrieben, solange kein owner: admin-Versuch hinterließ keine Zeile
    // (die owner-Zeile ist die einzige).
    expect(repo.rows.get("t_a")?.get("imprint")?.url).toBe("https://acme.example/impressum");
  });

  it("Validierung: javascript:-URL → 400; markdown zu groß → 413; Modus/URL-Inkonsistenz → 400", async () => {
    const { app, db, repo } = makeApp();
    const cookie = await sessionAs(app, db, HOST_A, "owner");

    const js = await putDoc(app, HOST_A, cookie, "privacy", {
      mode: "link",
      url: "javascript:alert(1)",
    });
    expect(js.status).toBe(400);
    expect(await js.json()).toMatchObject({ error: "invalid_url" });

    const big = await putDoc(app, HOST_A, cookie, "privacy", {
      mode: "markdown",
      markdown: "a".repeat(100 * 1024 + 1),
    });
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: "markdown_too_large" });

    const inconsistent = await putDoc(app, HOST_A, cookie, "privacy", {
      mode: "link",
      markdown: "# no url",
    });
    expect(inconsistent.status).toBe(400);

    expect(repo.rows.get("t_a")?.size ?? 0).toBe(0); // nichts geschrieben
  });

  it("unbekannter docType → 404; kaputtes JSON → 400; fehlendes Binding → 503", async () => {
    const { app, db } = makeApp();
    const cookie = await sessionAs(app, db, HOST_A, "owner");

    const bad = await putDoc(app, HOST_A, cookie, "cookies", LINK_BODY);
    expect(bad.status).toBe(404);

    const brokenJson = await app.request("/api/v1/admin/legal/imprint", {
      method: "PUT",
      headers: { host: HOST_A, cookie, "content-type": "application/json" },
      body: "{nope",
    });
    expect(brokenJson.status).toBe(400);
    expect(await brokenJson.json()).toMatchObject({ error: "invalid_json" });

    const { app: app2, db: db2 } = makeApp(false);
    const cookie2 = await sessionAs(app2, db2, HOST_A, "owner");
    const noBinding = await putDoc(app2, HOST_A, cookie2, "imprint", LINK_BODY);
    expect(noBinding.status).toBe(503);
    expect(await noBinding.json()).toMatchObject({ error: "legal_unavailable" });
  });
});

describe("GET /api/v1/admin/legal (Status-Übersicht, admin darf lesen, nicht-blockierend)", () => {
  it("admin → 200 mit Status aller 3 Docs; fehlende sind present:false", async () => {
    const { app, db } = makeApp();
    const ownerCookie = await sessionAs(app, db, HOST_A, "owner");
    await putDoc(app, HOST_A, ownerCookie, "imprint", LINK_BODY);

    const adminCookie = await sessionAs(app, db, HOST_A, "admin");
    const res = await app.request("/api/v1/admin/legal", {
      headers: { host: HOST_A, cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      docs: { docType: string; present: boolean; mode: string | null }[];
    };
    const byType = Object.fromEntries(body.docs.map((d) => [d.docType, d]));
    expect(byType.imprint).toMatchObject({ present: true, mode: "link" });
    expect(byType.privacy).toMatchObject({ present: false, mode: null });
    expect(byType.terms).toMatchObject({ present: false, mode: null });
  });
});

describe("Tenant-Isolation", () => {
  it("owner von t_a setzt Impressum → in t_b weder admin-Status noch public sichtbar", async () => {
    const { app, db, repo } = makeApp();
    const ownerA = await sessionAs(app, db, HOST_A, "owner");
    expect((await putDoc(app, HOST_A, ownerA, "imprint", LINK_BODY)).status).toBe(200);

    // Schreiben traf NUR t_a:
    expect(repo.rows.get("t_a")?.has("imprint")).toBe(true);
    expect(repo.rows.get("t_b")?.has("imprint") ?? false).toBe(false);

    // Public GET auf t_b → 404 (obwohl t_a das Doc hat):
    const publicB = await app.request("/api/v1/legal/imprint", { headers: { host: HOST_B } });
    expect(publicB.status).toBe(404);

    // Admin-Status auf t_b zeigt imprint als fehlend:
    const adminB = await sessionAs(app, db, HOST_B, "admin");
    const statusB = await app.request("/api/v1/admin/legal", {
      headers: { host: HOST_B, cookie: adminB },
    });
    const body = (await statusB.json()) as { docs: { docType: string; present: boolean }[] };
    expect(body.docs.find((d) => d.docType === "imprint")?.present).toBe(false);
  });
});

describe("GET /api/v1/legal/:docType (public, ohne Session)", () => {
  it("gesetztes Link-Doc wird OHNE Session geliefert; nicht gesetzt → 404", async () => {
    const { app, db } = makeApp();
    const owner = await sessionAs(app, db, HOST_A, "owner");
    await putDoc(app, HOST_A, owner, "imprint", LINK_BODY);

    const res = await app.request("/api/v1/legal/imprint", { headers: { host: HOST_A } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      docType: "imprint",
      mode: "link",
      url: "https://acme.example/impressum",
    });

    const missing = await app.request("/api/v1/legal/privacy", { headers: { host: HOST_A } });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "not_found" });
  });

  it("Markdown mit <script> wird 1:1 als Text zurückgegeben (kein HTML-Rendering, nicht ausgeführt)", async () => {
    const { app, db } = makeApp();
    const owner = await sessionAs(app, db, HOST_A, "owner");
    const md = "# Datenschutz\n\n<script>alert('xss')</script>";
    expect(
      (await putDoc(app, HOST_A, owner, "privacy", { mode: "markdown", markdown: md })).status,
    ).toBe(200);

    const res = await app.request("/api/v1/legal/privacy", { headers: { host: HOST_A } });
    expect(res.status).toBe(200);
    // Antwort ist JSON (Daten), NICHT text/html — der Script-Tag ist reiner Text.
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    const body = (await res.json()) as { mode: string; markdown: string };
    expect(body.mode).toBe("markdown");
    expect(body.markdown).toBe(md);
  });

  it("unbekannter docType → 404; fehlendes Binding → 503 fail-closed", async () => {
    const { app } = makeApp();
    const bad = await app.request("/api/v1/legal/cookies", { headers: { host: HOST_A } });
    expect(bad.status).toBe(404);

    const { app: app2 } = makeApp(false);
    const noBinding = await app2.request("/api/v1/legal/imprint", { headers: { host: HOST_A } });
    expect(noBinding.status).toBe(503);
    expect(await noBinding.json()).toMatchObject({ error: "legal_unavailable" });
  });
});

describe("Nicht-Blockieren: Legal-Zustand beeinflusst andere Routen nicht", () => {
  it("ohne gesetzte Docs bleibt Sign-up/Sign-in möglich und /tenant erreichbar", async () => {
    const { app } = makeApp();
    // Kein Legal-Doc gesetzt.
    const tenant = await app.request("/api/v1/tenant", { headers: { host: HOST_A } });
    expect(tenant.status).toBe(200);

    const signUp = await postJson(app, `${AUTH_BASE_PATH}/sign-up/email`, HOST_A, {
      email: "nobody@example.com",
      password: PASSWORD,
      name: "N",
    });
    expect(signUp.status).toBe(200);
  });
});
