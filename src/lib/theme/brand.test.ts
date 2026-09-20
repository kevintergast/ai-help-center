import { describe, expect, it } from "vitest";
import { PLATFORM_FAVICON_URL, faviconUrlFor } from "./brand";

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
