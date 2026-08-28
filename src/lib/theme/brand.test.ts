import { describe, expect, it } from "vitest";
import { PLATFORM_FAVICON_URL, brandingToStyle, faviconUrlFor } from "./brand";

/**
 * SSR-Branding: das Root-Layout legt genau dieses Objekt als Inline-Style aufs
 * <html> (erster Paint = Mandanten-Farben, kein FOUC). Ein DOM-Render-Test des
 * Layouts existiert bewusst NICHT (keine DOM-Testlib im Projekt) — der Vertrag
 * "Branding → CSS-Variablen" wird hier als Unit abgesichert.
 */
describe("brandingToStyle", () => {
  it("mappt das Tenant-Branding auf die drei --brand-*-Variablen", () => {
    expect(
      brandingToStyle({
        logoUrl: null,
        colorPrimary: "#e11d48",
        colorAccent: "#f59e0b",
        colorPrimaryFg: "#ffffff",
      }),
    ).toEqual({
      "--brand-primary": "#e11d48",
      "--brand-accent": "#f59e0b",
      "--brand-primary-fg": "#ffffff",
    });
  });
});

describe("faviconUrlFor (Tab-Icon-Kette, 0031)", () => {
  const base = { colorPrimary: "#000000", colorAccent: "#111111", colorPrimaryFg: "#ffffff" };

  it("eigenes Favicon gewinnt vor dem Logo", () => {
    expect(
      faviconUrlFor({
        ...base,
        logoUrl: "/api/v1/branding/logo?v=5",
        faviconUrl: "/api/v1/branding/logo?variant=favicon&v=5",
      }),
    ).toBe("/api/v1/branding/logo?variant=favicon&v=5");
  });

  it("ohne eigenes Favicon übernimmt AUTOMATISCH das helle Logo", () => {
    // Der gemeldete Fehlerfall: Instanz mit Logo zeigte weiter das
    // Plattform-Icon im Browser-Tab.
    expect(faviconUrlFor({ ...base, logoUrl: "/api/v1/branding/logo?v=9" })).toBe(
      "/api/v1/branding/logo?v=9",
    );
  });

  it("ohne beides das Plattform-Icon", () => {
    expect(faviconUrlFor({ ...base, logoUrl: null, faviconUrl: null })).toBe(PLATFORM_FAVICON_URL);
  });
});
