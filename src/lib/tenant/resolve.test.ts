import { describe, expect, it } from "vitest";
import { isOperatorHost, tenantSlugFromHost } from "./resolve";

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

  it("reservierte Subdomains (auth/www/api/app) lösen NIE zu einem Kunden-Tenant auf", () => {
    // auth.hallofhelp.app ist der zentrale OAuth-Gateway-Host — darf nicht als
    // Slug "auth" auf einen (potenziell fremden) Tenant kollabieren.
    expect(tenantSlugFromHost("auth.hallofhelp.app")).toBeNull();
    expect(tenantSlugFromHost("api.hallofhelp.app")).toBeNull();
    expect(tenantSlugFromHost("www.hallofhelp.app")).toBeNull();
    // app.hallofhelp.app ist die Operator-Instanz (Punkt 4b) — kein Kunde darf
    // sie per Slug "app" kapern.
    expect(tenantSlugFromHost("app.hallofhelp.app")).toBeNull();
    // Gegenprobe: ein regulärer Slug bleibt unberührt.
    expect(tenantSlugFromHost("acme.hallofhelp.app")).toBe("acme");
  });
});

describe("isOperatorHost (Punkt 4b — Betreiber-Instanz)", () => {
  it("erkennt app.<base> als Operator-Host (host-neutral, wie der Gateway)", () => {
    expect(isOperatorHost("app.hallofhelp.app")).toBe(true);
    expect(isOperatorHost("app.hallofhelp.com")).toBe(true);
    expect(isOperatorHost("app.localhost:3000")).toBe(true);
    expect(isOperatorHost("APP.hallofhelp.app")).toBe(true);
  });

  it("ist NIE für Kunden-Hosts, Apex oder andere reservierte Subdomains true", () => {
    expect(isOperatorHost("acme.hallofhelp.app")).toBe(false);
    expect(isOperatorHost("hallofhelp.app")).toBe(false);
    expect(isOperatorHost("auth.hallofhelp.app")).toBe(false);
    // Kein Kapern über verschachtelte/gefälschte Labels:
    expect(isOperatorHost("app.evil.com")).toBe(false);
    expect(isOperatorHost("app.acme.hallofhelp.app")).toBe(false);
    expect(isOperatorHost(null)).toBe(false);
  });

  it("gibt null für unbekannte Custom-Domains zurück (später via D1)", () => {
    expect(tenantSlugFromHost("hilfe.kunde.de")).toBeNull();
  });
});
