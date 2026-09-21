import { describe, expect, it } from "vitest";
import { parsePromptSuggestions } from "./prompt-suggestions";

/**
 * FRAGE-VORSCHLÄGE. Verhinderte Fehlerfälle:
 *  - Ein leer gelassenes Feld wird als Fehler gewertet statt als „weglassen" —
 *    dann kann man einen Vorschlag nicht mehr loswerden.
 *  - Mehr als vier rutschen durch und füllen die Startseite zu.
 *  - Ein überlanger Satz bricht die Anregungs-Zeile auf.
 */
describe("parsePromptSuggestions", () => {
  it("nimmt bis zu vier an, trimmt und normalisiert Leerraum", () => {
    expect(
      parsePromptSuggestions(["  Wie starte ich?  ", "Was kostet\n  das?"]),
    ).toEqual({ ok: true, suggestions: ["Wie starte ich?", "Was kostet das?"] });
  });

  it("lässt leere Einträge WEGFALLEN statt zu meckern", () => {
    expect(parsePromptSuggestions(["Erste Frage", "   ", "", "Zweite Frage"])).toEqual({
      ok: true,
      suggestions: ["Erste Frage", "Zweite Frage"],
    });
  });

  it("keine Vorschläge ist gültig", () => {
    expect(parsePromptSuggestions([])).toEqual({ ok: true, suggestions: [] });
    expect(parsePromptSuggestions(["  ", ""])).toEqual({ ok: true, suggestions: [] });
  });

  it("lehnt mehr als vier und zu lange ab — mit Position", () => {
    expect(parsePromptSuggestions(["a", "b", "c", "d", "e"])).toEqual({
      ok: false,
      error: "too_many",
    });
    expect(parsePromptSuggestions(["ok", "x".repeat(101)])).toEqual({
      ok: false,
      error: "too_long",
      index: 1,
    });
  });

  it("lehnt Nicht-Listen und Nicht-Texte ab", () => {
    expect(parsePromptSuggestions("Frage")).toEqual({ ok: false, error: "empty" });
    expect(parsePromptSuggestions([42])).toEqual({ ok: false, error: "empty", index: 0 });
  });
});
