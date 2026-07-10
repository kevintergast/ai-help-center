import { describe, expect, it } from "vitest";
import { brandingToStyle } from "./brand";

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
