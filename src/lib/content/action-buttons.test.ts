import { describe, expect, it } from "vitest";
import { isAllowedActionHref, isExternalHref, parseActionButtonInput } from "./action-buttons";

/**
 * AKTIONS-KNÖPFE. Verhinderte Fehlerfälle:
 *  - Ein `javascript:`- oder protokoll-relatives Ziel landet im Kopf JEDER
 *    Seite des Hilfezentrums.
 *  - Ein unbekannter Symbolname wird still geschluckt → der Nutzer setzt ein
 *    Symbol und sieht keins.
 *  - Eine erfundene Variante rutscht durch und rendert ohne Klassen.
 */

describe("isAllowedActionHref", () => {
  it("nimmt https und interne Pfade", () => {
    for (const href of ["https://cal.com/smao", "/contact", "/erste-schritte"]) {
      expect(isAllowedActionHref(href), href).toBe(true);
    }
  });

  it("lehnt unverschlüsselt, protokoll-relativ und Skript-Schemata ab", () => {
    for (const href of [
      "http://cal.com/smao",
      "//fremde.example",
      "javascript:alert(1)",
      "data:text/html,x",
      "",
      "   ",
    ]) {
      expect(isAllowedActionHref(href), href).toBe(false);
    }
  });
});

describe("isExternalHref", () => {
  it("unterscheidet innen von außen", () => {
    expect(isExternalHref("https://cal.com/smao")).toBe(true);
    expect(isExternalHref("/contact")).toBe(false);
  });
});

describe("parseActionButtonInput", () => {
  it("nimmt einen vollständigen Knopf an und trimmt", () => {
    expect(
      parseActionButtonInput({
        label: "  Termin buchen  ",
        icon: "play",
        href: " https://cal.com/smao ",
        variant: "colored",
      }),
    ).toEqual({
      ok: true,
      button: { label: "Termin buchen", icon: "play", href: "https://cal.com/smao", variant: "colored" },
    });
  });

  it("Symbol ist freiwillig, ein falscher Name aber ein Fehler", () => {
    const ohne = parseActionButtonInput({ label: "Los", href: "/contact", variant: "ghost" });
    expect(ohne).toEqual({
      ok: true,
      button: { label: "Los", icon: null, href: "/contact", variant: "ghost" },
    });
    expect(
      parseActionButtonInput({ label: "Los", href: "/contact", variant: "ghost", icon: "rakete" }),
    ).toEqual({ ok: false, error: "invalid_icon" });
  });

  it("verlangt Beschriftung, Ziel und eine bekannte Variante", () => {
    expect(parseActionButtonInput({ label: " ", href: "/x", variant: "ghost" })).toEqual({
      ok: false,
      error: "label_required",
    });
    expect(
      parseActionButtonInput({ label: "x".repeat(25), href: "/x", variant: "ghost" }),
    ).toEqual({ ok: false, error: "label_too_long" });
    expect(parseActionButtonInput({ label: "Los", variant: "ghost" })).toEqual({
      ok: false,
      error: "href_required",
    });
    expect(parseActionButtonInput({ label: "Los", href: "/x", variant: "knallbunt" })).toEqual({
      ok: false,
      error: "invalid_variant",
    });
    expect(
      parseActionButtonInput({ label: "Los", href: "javascript:alert(1)", variant: "ghost" }),
    ).toEqual({ ok: false, error: "invalid_href" });
  });
});
