import { describe, expect, it } from "vitest";
import { shouldGuardNavigation } from "./nav-guard";

/**
 * Verhinderter Fehlerfall (REAL passiert, 2026-08-22): Klick auf eine
 * Artikel-Link-Card im Bearbeiten-Modus navigierte client-seitig weg → der
 * komplette ungespeicherte Entwurf war verloren (beforeunload greift bei
 * Next-`<Link>` nicht). Zweiter Fehlerfall: ein zu gieriger Guard, der bei
 * neuen Tabs/Downloads/mailto fragt und dadurch ignoriert wird.
 */

const base = { dirty: true, origin: "https://demo.hallofhelp.com", href: "/artikel-x" };

describe("shouldGuardNavigation", () => {
  it("fragt bei same-origin-Navigation mit ungespeichertem Stand", () => {
    expect(shouldGuardNavigation(base)).toBe(true);
    expect(shouldGuardNavigation({ ...base, href: "https://demo.hallofhelp.com/admin/articles" })).toBe(
      true,
    );
  });

  it("nichts zu verlieren → kein Dialog", () => {
    expect(shouldGuardNavigation({ ...base, dirty: false })).toBe(false);
  });

  it("neue Tabs, Downloads, Modifier-Klicks bleiben unberührt", () => {
    expect(shouldGuardNavigation({ ...base, target: "_blank" })).toBe(false);
    expect(shouldGuardNavigation({ ...base, download: true })).toBe(false);
    expect(shouldGuardNavigation({ ...base, modified: true })).toBe(false);
    expect(shouldGuardNavigation({ ...base, target: "_self" })).toBe(true); // explizit gleiches Fenster
  });

  it("Hash-Sprünge, mailto/tel und fremde Hosts werden nicht abgefangen", () => {
    expect(shouldGuardNavigation({ ...base, href: "#weiter" })).toBe(false);
    expect(shouldGuardNavigation({ ...base, href: "mailto:hi@example.com" })).toBe(false);
    expect(shouldGuardNavigation({ ...base, href: "tel:+491234" })).toBe(false);
    // Fremde Origin: dort greift beforeunload (Browser fragt selbst).
    expect(shouldGuardNavigation({ ...base, href: "https://example.com/x" })).toBe(false);
  });

  it("kaputte/leere hrefs werfen nicht", () => {
    expect(shouldGuardNavigation({ ...base, href: null })).toBe(false);
    expect(shouldGuardNavigation({ ...base, href: "http://" })).toBe(false);
  });
});
