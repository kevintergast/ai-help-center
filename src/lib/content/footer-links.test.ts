import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEGAL_FOOTER,
  MAX_FOOTER_LABEL,
  parseFooterLinkInput,
  parseLegalFooterInput,
} from "./footer-links";

/**
 * Verhinderte Fehlerfälle (kein Coverage-Selbstzweck):
 *
 *  - Ein Fuß-Link mit `javascript:`/`http:`-Ziel stünde auf JEDER Seite der
 *    Instanz. Die Prüfung teilt sich die Regel mit den Kopf-Knöpfen; dieser
 *    Test hält fest, dass sie hier wirklich greift und nicht vergessen wurde.
 *  - `parseLegalFooterInput` entscheidet, ob ein Rechtstext-Link erscheint.
 *    Ein fehlendes Feld muss AN bedeuten — würde es AUS bedeuten, nähme ein
 *    unvollständiger Aufruf (ältere Oberfläche, Maschinen-Tür) stillschweigend
 *    die Datenschutz-Verlinkung von der Instanz.
 */

describe("parseFooterLinkInput", () => {
  it("nimmt https-Adressen und interne Pfade", () => {
    expect(parseFooterLinkInput({ label: "Status", href: "https://status.smao.ai" })).toEqual({
      ok: true,
      link: { label: "Status", href: "https://status.smao.ai" },
    });
    expect(parseFooterLinkInput({ label: "Kontakt", href: "/contact" })).toMatchObject({
      ok: true,
      link: { href: "/contact" },
    });
  });

  it("schneidet umgebende Leerzeichen weg", () => {
    expect(parseFooterLinkInput({ label: "  Status  ", href: "  /status  " })).toEqual({
      ok: true,
      link: { label: "Status", href: "/status" },
    });
  });

  it("lehnt Skript-, Klartext- und protokoll-relative Ziele ab", () => {
    for (const href of ["javascript:alert(1)", "http://fremde.example", "//fremde.example", "data:text/html,x"]) {
      expect(parseFooterLinkInput({ label: "X", href })).toEqual({
        ok: false,
        error: "invalid_href",
      });
    }
  });

  it("verlangt Beschriftung und Ziel", () => {
    expect(parseFooterLinkInput({ label: "  ", href: "/x" })).toEqual({
      ok: false,
      error: "label_required",
    });
    expect(parseFooterLinkInput({ label: "X", href: "" })).toEqual({
      ok: false,
      error: "href_required",
    });
    expect(parseFooterLinkInput({ label: "x".repeat(MAX_FOOTER_LABEL + 1), href: "/x" })).toEqual({
      ok: false,
      error: "label_too_long",
    });
  });
});

describe("parseLegalFooterInput", () => {
  it("behandelt fehlende Felder als AN (Bestandsverhalten)", () => {
    expect(parseLegalFooterInput({})).toEqual(DEFAULT_LEGAL_FOOTER);
    expect(parseLegalFooterInput(undefined)).toEqual(DEFAULT_LEGAL_FOOTER);
    expect(parseLegalFooterInput({ imprint: false })).toEqual({
      imprint: false,
      privacy: true,
      terms: true,
    });
  });

  it("schaltet nur bei echtem false ab — nicht bei „falsy“", () => {
    expect(parseLegalFooterInput({ privacy: 0, terms: "" })).toEqual(DEFAULT_LEGAL_FOOTER);
    expect(parseLegalFooterInput({ privacy: false })).toMatchObject({ privacy: false });
  });
});
