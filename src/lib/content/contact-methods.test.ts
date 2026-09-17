import { describe, expect, it } from "vitest";
import { contactMethodHref, parseContactMethodInput, type ContactMethod } from "./contact-methods";

/**
 * KONTAKTWEGE. Verhinderte Fehlerfälle:
 *  - Ein Schema-Schmuggel (`javascript:`) landet als Klickziel auf einer Seite,
 *    die jeder Endnutzer erreicht.
 *  - Eine korrekt geschriebene deutsche Rufnummer wird abgelehnt, weil die
 *    Prüfung zu streng ist — der Kunde kann seinen echten Weg nicht pflegen.
 *  - `tel:` behält Leerzeichen und Schrägstriche, woran Telefon-Apps scheitern.
 *  - Formular-Karte trägt zusätzlich einen Wert → zwei Wahrheiten in einer Karte.
 */

const m = (over: Partial<ContactMethod>): ContactMethod => ({
  id: "cm_1",
  kind: "email",
  title: "Support",
  description: "",
  value: "hilfe@example.com",
  ...over,
});

describe("parseContactMethodInput", () => {
  it("nimmt Adresse und Beschreibung an und trimmt", () => {
    expect(
      parseContactMethodInput({
        kind: "email",
        title: "  Support  ",
        description: " Antwort binnen 24 h ",
        value: " hilfe@example.com ",
      }),
    ).toEqual({
      ok: true,
      method: {
        kind: "email",
        title: "Support",
        description: "Antwort binnen 24 h",
        value: "hilfe@example.com",
      },
    });
  });

  it("lässt echte Rufnummern in üblichen Schreibweisen durch", () => {
    for (const value of ["+49 30 123456", "(030) 123-456", "0800 1234567", "+1 415 555 0132"]) {
      const res = parseContactMethodInput({ kind: "phone", title: "Hotline", value });
      expect(res.ok, value).toBe(true);
    }
  });

  it("lehnt Unsinn und Schema-Schmuggel ab", () => {
    for (const value of ["javascript:alert(1)", "ruf mich an", "12"]) {
      expect(parseContactMethodInput({ kind: "phone", title: "T", value })).toEqual({
        ok: false,
        error: "invalid_phone",
      });
    }
    for (const value of ["javascript:alert(1)", "keine-adresse", "a@b"]) {
      expect(parseContactMethodInput({ kind: "email", title: "T", value })).toEqual({
        ok: false,
        error: "invalid_email",
      });
    }
  });

  it("wirft beim Formular einen mitgeschickten Wert weg", () => {
    expect(parseContactMethodInput({ kind: "form", title: "Schreib uns", value: "x@y.z" })).toEqual({
      ok: true,
      method: { kind: "form", title: "Schreib uns", description: "", value: "" },
    });
  });

  it("verlangt Titel und Wert, begrenzt die Längen, lehnt fremde Arten ab", () => {
    expect(parseContactMethodInput({ kind: "email", title: " ", value: "a@b.de" })).toEqual({
      ok: false,
      error: "title_required",
    });
    expect(parseContactMethodInput({ kind: "email", title: "x".repeat(81), value: "a@b.de" })).toEqual({
      ok: false,
      error: "title_too_long",
    });
    expect(
      parseContactMethodInput({ kind: "form", title: "T", description: "x".repeat(201) }),
    ).toEqual({ ok: false, error: "description_too_long" });
    expect(parseContactMethodInput({ kind: "email", title: "T" })).toEqual({
      ok: false,
      error: "value_required",
    });
    expect(parseContactMethodInput({ kind: "fax", title: "T" })).toEqual({
      ok: false,
      error: "invalid_kind",
    });
  });
});

describe("contactMethodHref", () => {
  it("baut mailto und ein tel OHNE Trennzeichen", () => {
    expect(contactMethodHref(m({}))).toBe("mailto:hilfe@example.com");
    expect(contactMethodHref(m({ kind: "phone", value: "+49 (30) 123-456" }))).toBe("tel:+4930123456");
  });

  it("liefert für das Formular kein Ziel — die Karte IST das Formular", () => {
    expect(contactMethodHref(m({ kind: "form", value: "" }))).toBeNull();
  });
});
