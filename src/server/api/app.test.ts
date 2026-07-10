import { describe, expect, it } from "vitest";
import { app } from "./app";

/**
 * Tests der DEFAULT-Instanz (echte Runtime-Deps). Ohne Cloudflare-Kontext
 * (Unit-Tests) greift der dokumentierte DEV-ONLY-Registry-Fallback der
 * Tenant-Auflösung; Auth ist hier nicht verfügbar (fail-closed → 401).
 * Die vollständige Auth-/Guard-Kette wird in app.security.test.ts mit
 * injizierten Fake-Deps (Memory-Auth) getestet.
 */
describe("API /api/v1 (Default-Instanz, Dev-Fallback ohne Cloudflare-Kontext)", () => {
  it("health antwortet ok", async () => {
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", version: "v1" });
  });

  it("health ist Liveness: antwortet auch für unbekannte Hosts (vor der Tenant-Middleware)", async () => {
    const res = await app.request("/api/v1/health", {
      headers: { host: "definitiv-unbekannt.example.com" },
    });
    expect(res.status).toBe(200);
  });

  it("löst den Tenant mandantensicher aus dem Host auf", async () => {
    const res = await app.request("/api/v1/tenant", {
      headers: { host: "acme.localhost:3000" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: "acme", defaultLocale: "en" });
  });

  it("fällt bei Apex-Host auf den Default-Tenant zurück (DEV-ONLY-Registry, ohne D1)", async () => {
    const res = await app.request("/api/v1/tenant", {
      headers: { host: "hallofhelp.app" },
    });
    expect(await res.json()).toMatchObject({ slug: "demo" });
  });

  it("unbekannte Route OHNE Session → 401 (Default-Deny läuft VOR dem 404; kein Route-Probing)", async () => {
    const res = await app.request("/api/v1/does-not-exist");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("geschützte Route OHNE Session → 401 (Auth ohne Bindings fail-closed)", async () => {
    const res = await app.request("/api/v1/admin/ping");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });
});
