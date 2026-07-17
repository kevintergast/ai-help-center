import { describe, expect, it } from "vitest";
import worker, { parseTenantHost } from "./index";

/**
 * WIDGET-DEMO. Verhinderte Fehlerfälle:
 *  - Reflected XSS / fremdes Script über den ?host=-Parameter (der Wert landet
 *    in einem <script src=…> — ein durchgelassenes Sonderzeichen wäre direkt
 *    Code-Injection auf der Testseite).
 *  - Snippet-Drift: die Seite bettet NICHT mehr das offizielle Kunden-Snippet
 *    (<script src="https://<host>/widget.js" async>) ein → Test testet nichts.
 */

describe("parseTenantHost", () => {
  it("erlaubt öffentliche Hosts (https) und localhost mit Port (http)", () => {
    expect(parseTenantHost("demo.hallofhelp.com")).toEqual({
      host: "demo.hallofhelp.com",
      origin: "https://demo.hallofhelp.com",
    });
    expect(parseTenantHost("App.HallofHelp.com")?.origin).toBe("https://app.hallofhelp.com");
    expect(parseTenantHost("app.localhost:3005")).toEqual({
      host: "app.localhost:3005",
      origin: "http://app.localhost:3005",
    });
    expect(parseTenantHost("localhost:8788")?.origin).toBe("http://localhost:8788");
  });

  it("lehnt alles ab, was kein reiner Hostname ist", () => {
    for (const bad of [
      null,
      "",
      '"><script>alert(1)</script>',
      "evil.com/pfad",
      "evil.com?x=1",
      "javascript:alert(1)",
      "https://evil.com",
      "evil.com:8443", // Port nur für localhost
      "host_mit_unterstrich.de",
      "-beginnt-mit-strich.de",
      "nur-ein-label",
      "a".repeat(260) + ".de",
    ]) {
      expect(parseTenantHost(bad)).toBeNull();
    }
  });
});

describe("fetch-Handler", () => {
  const env = { TENANT_HOST: "app.hallofhelp.com" };

  it("bettet das OFFIZIELLE Kunden-Snippet für den Default-Host ein", async () => {
    const res = await worker.fetch(new Request("https://demo.test/"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<script src="https://app.hallofhelp.com/widget.js" async></script>');
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("?host=-Override wechselt die Instanz; Müll fällt auf den Default zurück", async () => {
    const ok = await worker.fetch(new Request("https://demo.test/?host=kunde.hallofhelp.com"), env);
    expect(await ok.text()).toContain('src="https://kunde.hallofhelp.com/widget.js"');

    const evil = await worker.fetch(
      new Request(`https://demo.test/?host=${encodeURIComponent('"><script>alert(1)</script>')}`),
      env,
    );
    const html = await evil.text();
    expect(html).toContain('src="https://app.hallofhelp.com/widget.js"'); // Fallback
    expect(html).not.toContain("alert(1)");
  });

  it("localhost-Override lädt über http (lokale Produkt-Dev)", async () => {
    const res = await worker.fetch(new Request("https://demo.test/?host=app.localhost:3005"), env);
    expect(await res.text()).toContain('src="http://app.localhost:3005/widget.js"');
  });

  it("andere Pfade → 404 (die Demo ist genau EINE Seite)", async () => {
    const res = await worker.fetch(new Request("https://demo.test/admin"), env);
    expect(res.status).toBe(404);
  });
});
