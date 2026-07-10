import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import type { ApiEnv, AuthInstance, GuardSessionData } from "@/server/api/context";
import { requireFreshMfa } from "./guards";
import { runWithTenant } from "./tenant-context";

/**
 * UNIT-TESTS für den Step-up-Guard `requireFreshMfa` (Phase C, M-5).
 * Die Session kommt aus einem Fake-`getAuth` (kein DB-/Netz-Zugriff) — getestet
 * wird ausschließlich der Guard-Vertrag: 401 ohne (tenant-fremde) Session,
 * 403 `mfa_stepup_required` ohne frisches Verify, Durchlass nur bei
 * `mfaVerified && mfaVerifiedAt <= maxAgeSec` alt.
 */

const TENANT: Tenant = {
  id: "t_a",
  slug: "tenant-a",
  name: "tenant-a",
  customDomain: null,
  defaultLocale: "de",
  branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
};

function fakeAuth(data: GuardSessionData | null): AuthInstance {
  return { api: { getSession: async () => data } } as unknown as AuthInstance;
}

function appWith(data: GuardSessionData | null, maxAgeSec?: number) {
  const app = new Hono<ApiEnv>();
  app.use("*", (c, next) => {
    c.set("tenant", TENANT);
    c.set("getAuth", async () => fakeAuth(data));
    return runWithTenant(TENANT.id, () => next());
  });
  app.get("/x", requireFreshMfa(maxAgeSec), (c) => c.json({ ok: true }));
  return app;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

const USER = { role: "owner", twoFactorEnabled: true };

describe("requireFreshMfa (Step-up-Guard)", () => {
  it("keine Session → 401 unauthorized", async () => {
    const res = await appWith(null).request("/x");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("tenant-fremde Session → 401 (wie 'nicht eingeloggt', kein Existenz-Orakel)", async () => {
    const res = await appWith({
      session: { tenantId: "t_other", mfaVerified: true, mfaVerifiedAt: nowSec() },
      user: USER,
    }).request("/x");
    expect(res.status).toBe(401);
  });

  it("frisches Verify (innerhalb maxAgeSec) → Durchlass", async () => {
    const res = await appWith({
      session: { tenantId: "t_a", mfaVerified: true, mfaVerifiedAt: nowSec() - 10 },
      user: USER,
    }).request("/x");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("altes Verify (älter als maxAgeSec) → 403 mfa_stepup_required", async () => {
    const res = await appWith({
      session: { tenantId: "t_a", mfaVerified: true, mfaVerifiedAt: nowSec() - 301 },
      user: USER,
    }).request("/x");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "mfa_stepup_required" });
  });

  it("fehlender mfaVerifiedAt-Marker → 403 (fail-closed, Login-Marker reicht nicht)", async () => {
    const res = await appWith({
      session: { tenantId: "t_a", mfaVerified: true },
      user: USER,
    }).request("/x");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "mfa_stepup_required" });
  });

  it("mfaVerified=false trotz frischem Timestamp → 403 (beide Marker nötig)", async () => {
    const res = await appWith({
      session: { tenantId: "t_a", mfaVerified: false, mfaVerifiedAt: nowSec() },
      user: USER,
    }).request("/x");
    expect(res.status).toBe(403);
  });

  it("eigenes maxAgeSec wird respektiert", async () => {
    const data: GuardSessionData = {
      session: { tenantId: "t_a", mfaVerified: true, mfaVerifiedAt: nowSec() - 60 },
      user: USER,
    };
    expect((await appWith(data, 30).request("/x")).status).toBe(403);
    expect((await appWith(data, 120).request("/x")).status).toBe(200);
  });
});
