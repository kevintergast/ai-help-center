import { describe, expect, it } from "vitest";
import { isOperatorHost, tenantSlugFromHost } from "./resolve";

describe("tenantSlugFromHost", () => {
  it("liest den Slug aus einer Subdomain", () => {
    expect(tenantSlugFromHost("acme.hallofhelp.com")).toBe("acme");
    expect(tenantSlugFromHost("demo.localhost:3000")).toBe("demo");
  });

  it("gibt null für Apex, www und leeren Host zurück", () => {
    expect(tenantSlugFromHost("hallofhelp.com")).toBeNull();
    expect(tenantSlugFromHost("www.hallofhelp.com")).toBeNull();
    expect(tenantSlugFromHost(null)).toBeNull();
  });

  it("reservierte Subdomains (auth/www/api/app) lösen NIE zu einem Kunden-Tenant auf", () => {
    // auth.hallofhelp.com ist der zentrale OAuth-Gateway-Host — darf nicht als
    // Slug "auth" auf einen (potenziell fremden) Tenant kollabieren.
    expect(tenantSlugFromHost("auth.hallofhelp.com")).toBeNull();
    expect(tenantSlugFromHost("api.hallofhelp.com")).toBeNull();
    expect(tenantSlugFromHost("www.hallofhelp.com")).toBeNull();
    // app.hallofhelp.com ist die Operator-Instanz (Punkt 4b) — kein Kunde darf
    // sie per Slug "app" kapern.
    expect(tenantSlugFromHost("app.hallofhelp.com")).toBeNull();
    // Gegenprobe: ein regulärer Slug bleibt unberührt.
    expect(tenantSlugFromHost("acme.hallofhelp.com")).toBe("acme");
  });
});

describe("isOperatorHost (Punkt 4b — Betreiber-Instanz)", () => {
  it("erkennt app.<base> als Operator-Host (host-neutral, wie der Gateway)", () => {
    expect(isOperatorHost("app.hallofhelp.com")).toBe(true);
    expect(isOperatorHost("app.hallofhelp.com")).toBe(true);
    expect(isOperatorHost("app.localhost:3000")).toBe(true);
    expect(isOperatorHost("APP.hallofhelp.com")).toBe(true);
  });

  it("ist NIE für Kunden-Hosts, Apex oder andere reservierte Subdomains true", () => {
    expect(isOperatorHost("acme.hallofhelp.com")).toBe(false);
    expect(isOperatorHost("hallofhelp.com")).toBe(false);
    expect(isOperatorHost("auth.hallofhelp.com")).toBe(false);
    // Kein Kapern über verschachtelte/gefälschte Labels:
    expect(isOperatorHost("app.evil.com")).toBe(false);
    expect(isOperatorHost("app.acme.hallofhelp.com")).toBe(false);
    expect(isOperatorHost(null)).toBe(false);
  });

  it("gibt null für unbekannte Custom-Domains zurück (später via D1)", () => {
    expect(tenantSlugFromHost("hilfe.kunde.de")).toBeNull();
  });
});

describe("Development-Umgebung (dev.hallofhelp.com als eigene Basis-Domain)", () => {
  it("app.dev.hallofhelp.com ist die Operator-Instanz (Dev)", () => {
    expect(isOperatorHost("app.dev.hallofhelp.com")).toBe(true);
  });

  it("<slug>.dev.hallofhelp.com löst auf den Tenant-Slug auf (spiegelt Prod eine Ebene tiefer)", () => {
    expect(tenantSlugFromHost("demo.dev.hallofhelp.com")).toBe("demo");
    expect(tenantSlugFromHost("acme.dev.hallofhelp.com")).toBe("acme");
  });

  it("Dev-Zone-Apex und reservierte Dev-Subdomains lösen NICHT auf einen Kunden-Tenant auf", () => {
    expect(tenantSlugFromHost("dev.hallofhelp.com")).toBeNull(); // Apex der Dev-Zone
    expect(tenantSlugFromHost("app.dev.hallofhelp.com")).toBeNull(); // app reserviert → Operator via isOperatorHost
    expect(tenantSlugFromHost("auth.dev.hallofhelp.com")).toBeNull();
  });

  it("kein Kapern/Leak: Prod-Operator bleibt, app.<fremd> bleibt false", () => {
    expect(isOperatorHost("app.hallofhelp.com")).toBe(true);
    expect(isOperatorHost("app.dev.evil.com")).toBe(false);
  });
});
