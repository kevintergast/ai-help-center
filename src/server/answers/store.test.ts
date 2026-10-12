import { describe, expect, it } from "vitest";
import { parseSavedAnswerInput } from "./store";

/**
 * EINGANGSPRÜFUNG des Konto-Syncs. Was hier hereinkommt, hat ein Client
 * geschickt — also alles, was ein Browser senden kann, nicht nur das, was
 * unsere Oberfläche sendet.
 *
 * Die Bausteine (Migration 0050) tragen Quellen-Verweise und Bild-Ids. Ein
 * ungeprüfter Verweis würde dem Leser später einen Beleg unter einen Satz
 * setzen, der nicht dazu gehört, oder ein Bild aus einem fremden Artikel
 * laden. Beides muss hier scheitern, nicht erst in der Anzeige.
 */

const BASE = {
  id: "a1b2c3",
  question: "Wie geht das?",
  body: ["Erster Absatz."],
  citations: [{ id: "art-1", title: "Einrichtung", kind: "article", slug: "einrichtung" }],
  sourceRefs: [],
  grounded: true,
  savedAt: 1_700_000_000_000,
};

describe("parseSavedAnswerInput — Bausteine", () => {
  it("nimmt gültige Bausteine an und behält Schritt-Reihenfolge und Bild", () => {
    const parsed = parseSavedAnswerInput({
      ...BASE,
      parts: [
        { kind: "step", text: "Menü öffnen.", source: 0 },
        { kind: "image", imageId: "img-a", alt: "Das Menü", source: 0 },
        { kind: "text", text: "Fertig." },
      ],
    });
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed === "string") return;
    expect(parsed.parts).toEqual([
      { kind: "step", text: "Menü öffnen.", source: 0 },
      { kind: "image", imageId: "img-a", alt: "Das Menü", source: 0 },
      { kind: "text", text: "Fertig." },
    ]);
  });

  it("Quellen-Verweis ins Leere → abgelehnt (sonst stünde ein erfundener Beleg da)", () => {
    expect(
      parseSavedAnswerInput({ ...BASE, parts: [{ kind: "text", text: "X", source: 5 }] }),
    ).toBe("invalid_parts");
  });

  it("Bild OHNE Quelle → abgelehnt (ohne Slug gibt es keine Bild-Adresse)", () => {
    expect(
      parseSavedAnswerInput({ ...BASE, parts: [{ kind: "image", imageId: "i", alt: "a" }] }),
    ).toBe("invalid_parts");
  });

  it("Bild-Id mit Pfad-Zeichen → abgelehnt", () => {
    expect(
      parseSavedAnswerInput({
        ...BASE,
        parts: [{ kind: "image", imageId: "../../geheim", alt: "a", source: 0 }],
      }),
    ).toBe("invalid_parts");
  });

  it("unbekannte Baustein-Art → abgelehnt", () => {
    expect(
      parseSavedAnswerInput({ ...BASE, parts: [{ kind: "script", text: "X", source: 0 }] }),
    ).toBe("invalid_parts");
  });

  it("ohne `parts` bleibt es bei den Absätzen (alte Clients)", () => {
    const parsed = parseSavedAnswerInput(BASE);
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.parts).toBeUndefined();
    expect(parsed.body).toEqual(["Erster Absatz."]);
  });
});

describe("parseSavedAnswerInput — Zitate", () => {
  it("behält kind und slug (vorher verworfen — ohne sie fehlt dem Bild die Adresse)", () => {
    const parsed = parseSavedAnswerInput(BASE);
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.citations[0]).toEqual({
      id: "art-1",
      title: "Einrichtung",
      kind: "article",
      slug: "einrichtung",
    });
  });

  it("erfundene Quellen-Art oder unsauberer Slug → abgelehnt", () => {
    expect(
      parseSavedAnswerInput({ ...BASE, citations: [{ id: "a", title: "T", kind: "owner" }] }),
    ).toBe("invalid_citations");
    expect(
      parseSavedAnswerInput({ ...BASE, citations: [{ id: "a", title: "T", slug: "../etc" }] }),
    ).toBe("invalid_citations");
  });
});
