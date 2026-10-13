import { describe, expect, it } from "vitest";
import { buildAskMessages, parseAnswer, splitAnswerParagraphs } from "./generate";

/**
 * PROMPT + PARSER des dynamischen Hilfeartikels.
 *
 * Der Parser steht zwischen einem Modell, das alles liefern kann, und einer
 * Anzeige, die Belege und Bilder behauptet. Jeder Test hier verhindert einen
 * benennbaren Fehler beim Leser: ein Beleg unter einem Satz, der aus einer
 * anderen Quelle stammt; ein Bild, das zur falschen Aussage gehört oder gar
 * nicht lädt; eine leere Seite, weil das Modell kaputtes JSON geschickt hat.
 */

const SOURCES = [
  {
    index: 1,
    citationIndex: 0,
    images: [
      { id: "img-a", description: "Der Schalter im Kopfbereich" },
      { id: "img-b", description: "Das geöffnete Menü" },
    ],
  },
  { index: 2, citationIndex: 1, images: [] },
];

describe("buildAskMessages", () => {
  it("gibt Bilder mit Handle je Quelle mit — sonst kann das Modell keines benennen", () => {
    const [, user] = buildAskMessages("Wie geht das?", [
      {
        index: 1,
        articleTitle: "Einrichtung",
        text: "Zuerst den Schalter umlegen.",
        images: [{ id: "img-a", description: "Der Schalter" }],
      },
    ]);
    expect(user.content).toContain("B1.1: Der Schalter");
    expect(user.content).toContain("[Quelle 1]");
    // Die Bild-ID gehört NICHT in den Prompt: Das Modell soll Handles
    // zurückgeben, keine Ids erfinden können.
    expect(user.content).not.toContain("img-a");
  });

  it("weist Schritte auch ohne das Wort Schritt an und zeigt ein Beispiel", () => {
    // Live-Fund auf Staging: Auf „Wie erstelle ich mein erstes Hilfezentrum?"
    // kamen Absaetze statt Schritte, obwohl die Antwort ein Ablauf war. Das
    // Modell hielt sich an die abstrakte Regel nicht — mit Beispiel schon.
    const [system] = buildAskMessages("Frage", [
      { index: 1, articleTitle: "A", text: "Text" },
    ]);
    expect(system.content).toContain("NACHEINANDER");
    expect(system.content).toContain("Wie mache ich X?");
    expect(system.content).toContain('"type":"step"');
  });

  it("Quelle ohne Bilder bekommt keinen leeren Bilder-Block", () => {
    const [, user] = buildAskMessages("Frage", [
      { index: 1, articleTitle: "A", text: "Text" },
    ]);
    expect(user.content).not.toContain("VERFÜGBARE BILDER");
  });
});

describe("parseAnswer", () => {
  it("strukturierte Antwort: Schritte, Absatz und Bild mit Quelle je Baustein", () => {
    const raw = JSON.stringify({
      blocks: [
        { type: "text", text: "Kurz vorweg.", source: 2 },
        { type: "step", text: "Menü öffnen.", source: 1 },
        { type: "image", image: "B1.2", source: 1 },
        { type: "step", text: "Speichern.", source: 1 },
      ],
    });
    const { body, parts } = parseAnswer(raw, SOURCES);

    expect(parts).toEqual([
      { kind: "text", text: "Kurz vorweg.", source: 1 },
      { kind: "step", text: "Menü öffnen.", source: 0 },
      { kind: "image", imageId: "img-b", alt: "Das geöffnete Menü", source: 0 },
      { kind: "step", text: "Speichern.", source: 0 },
    ]);
    // KOMPATIBILITÄT: `body` trägt weiterhin alle Texte — gespeicherte
    // Antworten und ältere Clients zeigen damit die vollständige Antwort.
    expect(body).toEqual(["Kurz vorweg.", "Menü öffnen.", "Speichern."]);
  });

  it("erfundene Quellennummer: Text bleibt OHNE Beleg, Bild fliegt raus", () => {
    const raw = JSON.stringify({
      blocks: [
        { type: "text", text: "Behauptung.", source: 9 },
        { type: "image", image: "B9.1", source: 9 },
      ],
    });
    const { parts } = parseAnswer(raw, SOURCES);
    // Lieber kein Beleg als ein falscher.
    expect(parts).toEqual([{ kind: "text", text: "Behauptung." }]);
  });

  it("erfundenes Bild-Handle wird verworfen (sonst zeigt die Seite ein totes Bild)", () => {
    const raw = JSON.stringify({
      blocks: [
        { type: "text", text: "Dazu gibt es ein Bild.", source: 1 },
        { type: "image", image: "B1.7", source: 1 },
      ],
    });
    const { parts } = parseAnswer(raw, SOURCES);
    expect(parts?.filter((p) => p.kind === "image")).toEqual([]);
  });

  it("dasselbe Bild zweimal erscheint nur einmal", () => {
    const raw = JSON.stringify({
      blocks: [
        { type: "step", text: "Eins.", source: 1 },
        { type: "image", image: "B1.1", source: 1 },
        { type: "step", text: "Zwei.", source: 1 },
        { type: "image", image: "B1.1", source: 1 },
      ],
    });
    const { parts } = parseAnswer(raw, SOURCES);
    expect(parts?.filter((p) => p.kind === "image")).toHaveLength(1);
  });

  it("kaputtes JSON fällt auf Absätze zurück statt auf eine leere Seite", () => {
    const { body, parts } = parseAnswer("Erster Absatz.\n\nZweiter Absatz.", SOURCES);
    expect(parts).toBeUndefined();
    expect(body).toEqual(["Erster Absatz.", "Zweiter Absatz."]);
  });

  it("abgeschnittenes JSON (Token-Limit) fällt ebenfalls auf Absätze zurück", () => {
    const { body, parts } = parseAnswer('{"blocks":[{"type":"text","text":"Angefangen', SOURCES);
    expect(parts).toBeUndefined();
    expect(body.length).toBeGreaterThan(0);
  });

  it("JSON mit Vorrede: das Objekt wird herausgeschnitten", () => {
    const raw = 'Hier die Antwort:\n{"blocks":[{"type":"text","text":"Inhalt.","source":1}]}\nFertig.';
    const { parts } = parseAnswer(raw, SOURCES);
    expect(parts).toEqual([{ kind: "text", text: "Inhalt.", source: 0 }]);
  });

  it("nur Bilder ist keine Antwort → Prosa-Pfad", () => {
    const raw = JSON.stringify({ blocks: [{ type: "image", image: "B1.1", source: 1 }] });
    const { parts } = parseAnswer(raw, SOURCES);
    expect(parts).toBeUndefined();
  });

  it("Markdown-Reste im Baustein-Text werden entschärft", () => {
    const raw = JSON.stringify({
      blocks: [{ type: "step", text: "1. **Fett** und\nUmbruch", source: 1 }],
    });
    const { body } = parseAnswer(raw, SOURCES);
    expect(body).toEqual(["Fett und Umbruch"]);
  });

  it("deckelt die Bausteine (Modell-Weitschweifigkeit)", () => {
    const raw = JSON.stringify({
      blocks: Array.from({ length: 20 }, (_, i) => ({
        type: "step",
        text: `Schritt ${i}`,
        source: 1,
      })),
    });
    const { parts } = parseAnswer(raw, SOURCES);
    expect(parts?.length).toBe(8);
  });
});

describe("splitAnswerParagraphs (Prosa-Pfad bleibt)", () => {
  it("trennt an Leerzeilen und entfernt Listen-/Überschriften-Marker", () => {
    expect(splitAnswerParagraphs("# Titel\n\n- Punkt eins\n\n**Fett**")).toEqual([
      "Titel",
      "Punkt eins",
      "Fett",
    ]);
  });
});
