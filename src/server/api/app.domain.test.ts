import BetterSqlite3 from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import type { ProvisionResult } from "@/server/domains/provisioner";
import { D1DomainRepository } from "@/server/domains/store";
import type { TxtCheckResult } from "@/server/domains/verify";
import { D1TenantRepository } from "@/server/tenant/repository";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";

/**
 * CUSTOM-DOMAIN-FLOW end-to-end (echte 0001–0003-DDL via sqlite-Shim, Memory-
 * Auth). Verhinderte Fehlerfälle:
 *  - Nicht-Owner können die Instanz-Domain umlenken (Gating-Bypass).
 *  - Unverifizierte/beanspruchte Domains lösen im Tenant-Resolver auf
 *    (DER historische fail-closed-Punkt: getByCustomDomain nur 'verified').
 *  - Fremd-beanspruchte Domain lässt sich übernehmen (Hijack).
 *  - Fehlgeschlagener TXT-Check verifiziert trotzdem (fail-open).
 */

const HOST_DEMO = "demo.hallofhelp.com";
const TENANT_DEMO: Tenant = {
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

function makeFixture(opts: { txt?: TxtCheckResult; provision?: ProvisionResult } = {}) {
  const { txt = "verified", provision = "skipped" } = opts;
  const sqlite = new BetterSqlite3(":memory:");
  applyMigrations(sqlite, ["0001_tenants.sql", "0002_auth.sql", "0003_branding.sql"]);
  const d1 = d1FromSqlite(sqlite);

  const authDb: Record<string, Row[]> = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const txtCalls: { domain: string; token: string }[] = [];
  const deps: ApiDeps = {
    resolveTenant: async (host) =>
      (host ?? "").split(":")[0].toLowerCase() === HOST_DEMO ? TENANT_DEMO : null,
    createAuthForTenant: async () =>
      buildAuth({
        adapter: memoryAdapter(authDb)(tenantAuthOptions(TEST_SECRET)),
        secret: TEST_SECRET,
      }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
    getDomainDeps: async () => ({
      repo: new D1DomainRepository(d1),
      checkTxt: async (domain, token) => {
        txtCalls.push({ domain, token });
        return txt;
      },
      provision: async () => provision,
    }),
  };
  return { app: buildApiApp(deps), sqlite, d1, authDb, txtCalls };
}

type Fixture = ReturnType<typeof makeFixture>;

/** Session mit Rolle + MFA-Markern (Muster app.team.test.ts). */
async function session(f: Fixture, email: string, role: "user" | "admin" | "owner"): Promise<string> {
  const post = (path: string, body: unknown) =>
    f.app.request(path, {
      method: "POST",
      headers: { host: HOST_DEMO, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await post(`${AUTH_BASE_PATH}/sign-up/email`, { email, password: PASSWORD, name: "U" })).status).toBe(200);
  const user = f.authDb.auth_user.find((u) => u.email === email)!;
  user.email_verified = true;
  if (role !== "user") user.role = role;
  const signIn = await post(`${AUTH_BASE_PATH}/sign-in/email`, { email, password: PASSWORD });
  expect(signIn.status).toBe(200);
  if (role !== "user") {
    // MFA-Flags erst NACH dem Sign-in (sonst greift die echte 2FA-Challenge).
    user.two_factor_enabled = true;
    const s = f.authDb.auth_session.filter((x) => x.user_id === user.id).at(-1)!;
    s.mfa_verified = true;
  }
  return signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const req = (f: Fixture, method: string, path: string, cookie: string, body?: unknown) =>
  f.app.request(path, {
    method,
    headers: {
      host: HOST_DEMO,
      cookie,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

describe("Custom-Domain-Flow (/api/v1/admin/domain)", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it("Claim → pending mit TXT-Anleitung; Resolver löst NICHT auf (fail-closed)", async () => {
    const owner = await session(f, "owner@example.com", "owner");
    const res = await req(f, "PUT", "/api/v1/admin/domain", owner, { domain: "Hilfe.Kunde.de" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    expect(body.status).toBe("pending");
    expect(body.domain).toBe("hilfe.kunde.de");
    expect(body.txtRecordName).toBe("_hallofhelp-verify.hilfe.kunde.de");
    expect(body.txtRecordValue).toMatch(/^hoh-verify-[0-9a-f]{32}$/);

    // DER historische Sicherheitspunkt: pending darf NIE auflösen.
    const tenants = new D1TenantRepository(f.d1);
    expect(await tenants.getByCustomDomain("hilfe.kunde.de")).toBeNull();
  });

  it("Verify (TXT ok) → verified + Resolver löst auf; DELETE macht es rückgängig", async () => {
    const owner = await session(f, "owner@example.com", "owner");
    await req(f, "PUT", "/api/v1/admin/domain", owner, { domain: "hilfe.kunde.de" });

    const verify = await req(f, "POST", "/api/v1/admin/domain/verify", owner);
    expect(verify.status).toBe(200);
    expect(await verify.json()).toMatchObject({ ok: true, status: "verified", provisioning: "skipped" });
    // Der Check lief gegen Domain + gespeichertes Token.
    expect(f.txtCalls[0].domain).toBe("hilfe.kunde.de");
    expect(f.txtCalls[0].token).toMatch(/^hoh-verify-/);

    const tenants = new D1TenantRepository(f.d1);
    const resolved = await tenants.getByCustomDomain("hilfe.kunde.de");
    expect(resolved?.id).toBe("t_demo");

    const del = await req(f, "DELETE", "/api/v1/admin/domain", owner);
    expect(del.status).toBe(200);
    expect(await tenants.getByCustomDomain("hilfe.kunde.de")).toBeNull();
  });

  it("TXT nicht gefunden → 409 txt_not_found, Status bleibt pending", async () => {
    f = makeFixture({ txt: "not_found" });
    const owner = await session(f, "owner@example.com", "owner");
    await req(f, "PUT", "/api/v1/admin/domain", owner, { domain: "hilfe.kunde.de" });

    const verify = await req(f, "POST", "/api/v1/admin/domain/verify", owner);
    expect(verify.status).toBe(409);
    expect(await verify.json()).toEqual({ error: "txt_not_found" });

    const status = await req(f, "GET", "/api/v1/admin/domain", owner);
    expect(await status.json()).toMatchObject({ claim: { status: "pending" } });
    expect(new D1DomainRepository(f.d1)).toBeTruthy();
  });

  it("Gating: admin darf LESEN, aber nicht mutieren (owner-exklusiv)", async () => {
    const admin = await session(f, "admin@example.com", "admin");
    expect((await req(f, "GET", "/api/v1/admin/domain", admin)).status).toBe(200);
    expect((await req(f, "PUT", "/api/v1/admin/domain", admin, { domain: "a.de" })).status).toBe(403);
    expect((await req(f, "POST", "/api/v1/admin/domain/verify", admin)).status).toBe(403);
    expect((await req(f, "DELETE", "/api/v1/admin/domain", admin)).status).toBe(403);
  });

  it("Hijack-Schutz: fremd-beanspruchte Domain → 409 domain_taken", async () => {
    // Fremd-Claim direkt in der DDL (anderer Tenant t_acme aus dem 0001-Seed).
    f.sqlite
      .prepare(
        `INSERT INTO tenant_domain (id, tenant_id, domain, verification_token, status, created_at)
         VALUES ('x1', 't_acme', 'hilfe.kunde.de', 'hoh-verify-fremd', 'verified', 0)`,
      )
      .run();
    const owner = await session(f, "owner@example.com", "owner");
    const res = await req(f, "PUT", "/api/v1/admin/domain", owner, { domain: "hilfe.kunde.de" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "domain_taken" });
  });

  it("ungültige/reservierte Domain → 400 mit präzisem Code", async () => {
    const owner = await session(f, "owner@example.com", "owner");
    expect(
      await (await req(f, "PUT", "/api/v1/admin/domain", owner, { domain: "https://kunde.de" })).json(),
    ).toEqual({ error: "invalid_domain" });
    expect(
      await (await req(f, "PUT", "/api/v1/admin/domain", owner, { domain: "boese.hallofhelp.com" })).json(),
    ).toEqual({ error: "reserved_domain" });
  });
});
