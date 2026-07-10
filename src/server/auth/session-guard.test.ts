import { describe, expect, it } from "vitest";
import {
  SessionTenantMismatchError,
  assertSessionTenant,
  enforceSessionTenant,
} from "./session-guard";
import { runWithTenant } from "./tenant-context";

describe("Session-Tenant-Enforcement", () => {
  it("assertSessionTenant lässt eine Session des eigenen Tenants passieren", () => {
    runWithTenant("t_a", () => {
      const s = { tenantId: "t_a", id: "sess_1" };
      expect(assertSessionTenant(s)).toBe(s);
    });
  });

  it("assertSessionTenant wirft bei fremder tenantId (Cross-Tenant-Session)", () => {
    runWithTenant("t_a", () => {
      expect(() => assertSessionTenant({ tenantId: "t_b" })).toThrow(SessionTenantMismatchError);
    });
  });

  it("assertSessionTenant wirft, wenn die Session keine tenantId trägt (fail-closed)", () => {
    runWithTenant("t_a", () => {
      expect(() => assertSessionTenant({})).toThrow(SessionTenantMismatchError);
    });
  });

  it("assertSessionTenant wirft ohne Tenant-Kontext (fail-closed)", () => {
    expect(() => assertSessionTenant({ tenantId: "t_a" })).toThrow();
  });

  it("enforceSessionTenant gibt die Session im eigenen Tenant zurück", () => {
    runWithTenant("t_a", () => {
      const s = { tenantId: "t_a" };
      expect(enforceSessionTenant(s)).toBe(s);
    });
  });

  it("enforceSessionTenant nullt eine tenant-fremde Session (statt zu werfen)", () => {
    runWithTenant("t_a", () => {
      expect(enforceSessionTenant({ tenantId: "t_b" })).toBeNull();
    });
  });

  it("enforceSessionTenant behandelt null/undefined als 'keine Session'", () => {
    runWithTenant("t_a", () => {
      expect(enforceSessionTenant(null)).toBeNull();
      expect(enforceSessionTenant(undefined)).toBeNull();
    });
  });

  it("enforceSessionTenant nullt ohne Tenant-Kontext (fail-closed, kein throw)", () => {
    expect(enforceSessionTenant({ tenantId: "t_a" })).toBeNull();
  });
});
