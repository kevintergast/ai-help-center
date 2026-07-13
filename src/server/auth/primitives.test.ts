import { describe, expect, it } from "vitest";
import { deriveTenantKey } from "./crypto";
import { canonicalizeEmail } from "./email";
import { getAuthSecret } from "./secret";
import { currentTenantId, currentTenantIdOrThrow, runWithTenant } from "./tenant-context";

describe("deriveTenantKey (HKDF)", () => {
  it("ist deterministisch je (secret, tenant)", async () => {
    expect(await deriveTenantKey("base", "t_acme")).toBe(await deriveTenantKey("base", "t_acme"));
  });
  it("unterscheidet sich pro Tenant und pro Basis-Secret", async () => {
    const acme = await deriveTenantKey("base", "t_acme");
    expect(acme).not.toBe(await deriveTenantKey("base", "t_demo"));
    expect(acme).not.toBe(await deriveTenantKey("anders", "t_acme"));
  });
});

describe("canonicalizeEmail", () => {
  it("trimmt, kleinschreibt und normalisiert", () => {
    expect(canonicalizeEmail("  Kevin@Example.COM ")).toBe("kevin@example.com");
  });
});

describe("getAuthSecret", () => {
  it("akzeptiert einen String (lokal)", async () => {
    expect(await getAuthSecret({ AUTH_SECRET: "abc" })).toBe("abc");
  });
  it("löst Secrets-Store-Bindings via .get() auf", async () => {
    expect(await getAuthSecret({ AUTH_SECRET: { get: async () => "xyz" } })).toBe("xyz");
  });
  it("wirft, wenn AUTH_SECRET fehlt", async () => {
    await expect(getAuthSecret({})).rejects.toThrow();
  });
});

describe("tenant-context (AsyncLocalStorage, fail-closed)", () => {
  it("liefert die tenantId innerhalb von runWithTenant", () => {
    runWithTenant("t_acme", () => {
      expect(currentTenantId()).toBe("t_acme");
      expect(currentTenantIdOrThrow()).toBe("t_acme");
    });
  });
  it("ist außerhalb null bzw. wirft (fail-closed)", () => {
    expect(currentTenantId()).toBeNull();
    expect(() => currentTenantIdOrThrow()).toThrow();
  });
  it("vermischt verschachtelte Kontexte nicht", () => {
    runWithTenant("t_a", () => {
      runWithTenant("t_b", () => expect(currentTenantId()).toBe("t_b"));
      expect(currentTenantId()).toBe("t_a");
    });
  });
});
