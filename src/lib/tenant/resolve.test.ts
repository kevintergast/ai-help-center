import { describe, expect, it } from "vitest";
import { tenantSlugFromHost } from "./resolve";

describe("tenantSlugFromHost", () => {
  it("liest den Slug aus einer Subdomain", () => {
    expect(tenantSlugFromHost("acme.hallofhelp.app")).toBe("acme");
    expect(tenantSlugFromHost("demo.localhost:3000")).toBe("demo");
  });

  it("gibt null für Apex, www und leeren Host zurück", () => {
    expect(tenantSlugFromHost("hallofhelp.app")).toBeNull();
    expect(tenantSlugFromHost("www.hallofhelp.com")).toBeNull();
    expect(tenantSlugFromHost(null)).toBeNull();
  });

  it("gibt null für unbekannte Custom-Domains zurück (später via D1)", () => {
    expect(tenantSlugFromHost("hilfe.kunde.de")).toBeNull();
  });
});
