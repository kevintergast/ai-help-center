import { describe, expect, it } from "vitest";
import { checkSlug, parseHelpCenterInput } from "./validate";

/**
 * Verhinderte reale Fehlerfälle: ein ungültiger/reservierter Slug wird zur
 * Subdomain und dürfte NIE durchrutschen (Kapern von app/auth/api/www,
 * DNS-untaugliche Labels); ein CSS-Injection-Farbwert dürfte nie ins Branding.
 */

describe("checkSlug (Format + Reservierung)", () => {
  it("akzeptiert gültige DNS-Label-Slugs", () => {
    expect(checkSlug("acme")).toBeNull();
    expect(checkSlug("acme-support")).toBeNull();
    expect(checkSlug("a1b2")).toBeNull();
  });

  it("lehnt ungültige Formate ab (Länge, Zeichen, führender/doppelter Bindestrich, Nicht-String)", () => {
    expect(checkSlug("ab")).toBe("invalid_format"); // < 3
    expect(checkSlug("-abc")).toBe("invalid_format");
    expect(checkSlug("abc-")).toBe("invalid_format");
    expect(checkSlug("a--b")).toBe("invalid_format");
    expect(checkSlug("Acme")).toBe("invalid_format"); // Großbuchstabe
    expect(checkSlug("acme_support")).toBe("invalid_format");
    expect(checkSlug("a".repeat(64))).toBe("invalid_format"); // > 63
    expect(checkSlug(123 as unknown)).toBe("invalid_format");
    expect(checkSlug(undefined)).toBe("invalid_format");
  });

  it("lehnt reservierte Slugs ab — inkl. app/auth/api/www und Blockliste", () => {
    expect(checkSlug("app")).toBe("reserved");
    expect(checkSlug("auth")).toBe("reserved");
    expect(checkSlug("api")).toBe("reserved");
    expect(checkSlug("www")).toBe("reserved");
    expect(checkSlug("admin")).toBe("reserved");
    expect(checkSlug("support")).toBe("reserved");
  });
});

describe("parseHelpCenterInput", () => {
  const base = { name: "Acme Support", slug: "acme", defaultLocale: "de" };

  it("nimmt eine gültige Eingabe an (Name getrimmt, Farben null, SEO default an)", () => {
    const parsed = parseHelpCenterInput({ ...base, name: "  Acme Support  " });
    expect(parsed).toEqual({
      name: "Acme Support",
      slug: "acme",
      defaultLocale: "de",
      colorPrimary: null,
      colorAccent: null,
      seoIndexable: true,
    });
  });

  it("SEO-Abfrage: false wird übernommen, Nicht-Boolesches abgelehnt", () => {
    expect(parseHelpCenterInput({ ...base, seoIndexable: false })).toMatchObject({
      seoIndexable: false,
    });
    expect(parseHelpCenterInput({ ...base, seoIndexable: "ja" })).toBe("invalid_seo_indexable");
  });

  it("nimmt gültige Hex-Farben an", () => {
    const parsed = parseHelpCenterInput({ ...base, colorPrimary: "#abc", colorAccent: "#112233" });
    expect(parsed).toMatchObject({ colorPrimary: "#abc", colorAccent: "#112233" });
  });

  it("weist Name/Slug/Locale/Farbe fehlerhaft mit stabilen Codes ab", () => {
    expect(parseHelpCenterInput({ ...base, name: "x" })).toBe("invalid_name");
    expect(parseHelpCenterInput({ ...base, slug: "app" })).toBe("invalid_slug");
    expect(parseHelpCenterInput({ ...base, slug: "NOPE" })).toBe("invalid_slug");
    expect(parseHelpCenterInput({ ...base, defaultLocale: "fr" })).toBe("invalid_locale");
    expect(parseHelpCenterInput({ ...base, colorPrimary: "red;}body{" })).toBe("invalid_color");
    expect(parseHelpCenterInput(null)).toBe("invalid_name");
  });
});
