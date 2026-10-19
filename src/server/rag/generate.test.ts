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
    destinations: [
      { href: "https://app.test/einstellungen", purpose: "Name und Sprache des Assistenten." },
      { href: "https://app.test/rufnummern", purpose: "Rufnummern des Assistenten." },
    ],
  },
  { index: 2, citationIndex: 1, images: [], destinations: [] },
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

  it("abgeschnittenes JSON: vollständige Bausteine werden GERETTET", () => {
    // LIVE-FUND 2026-10-14: Mit dem 256-Token-Default brach die Ausgabe
    // mitten im Objekt ab. Vorher ging dabei alles verloren UND der Rohtext
    // landete im Artikel. Jetzt überlebt, was fertig geschrieben wurde.
    const raw =
      '{"blocks":[{"type":"step","text":"Erster Schritt.","source":1},' +
      '{"type":"step","text":"Zweiter Schritt.","source":1},' +
      '{"type":"step","text":"Dritter abgeschnitt';
    const { body, parts } = parseAnswer(raw, SOURCES);
    expect(body).toEqual(["Erster Schritt.", "Zweiter Schritt."]);
    expect(parts).toHaveLength(2);
  });

  it("JSON-Rohtext erscheint NIEMALS als Antwort", () => {
    // Genau der Produktionsfehler: Der Leser sah {"blocks":[{"type":"text"…
    // als Artikeltext. Lieber keine Antwort — die Route bietet dann den
    // Weg zum Support an.
    for (const raw of [
      '{"blocks":[{"type":"text","text":"Angefangen',
      '{"blocks":',
      '{"type":"text","text":"ohne Umschlag',
    ]) {
      const { body, parts } = parseAnswer(raw, SOURCES);
      expect(parts).toBeUndefined();
      expect(body).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("blocks");
    }
  });

  it("echte Prosa bleibt Prosa (der Rückfall ist nicht pauschal leer)", () => {
    const { body } = parseAnswer("Das geht so.\n\nUnd dann so.", SOURCES);
    expect(body).toEqual(["Das geht so.", "Und dann so."]);
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

/**
 * ZIELE — unsichtbare Oberflächen-Verweise, die die KI in ihre Antwort
 * einbauen darf.
 *
 * Der gefährliche Fall ist nicht ein fehlender Link, sondern ein FALSCHER:
 * Ein erfundenes Handle oder eine selbst geschriebene Adresse würde Leser
 * aus einem Hilfezentrum heraus auf eine beliebige Seite schicken. Deshalb
 * darf nur durchkommen, was sich gegen den echten Kontext auflösen lässt.
 */
describe("parseAnswer — Ziele", () => {
  it("Knopf: gültiges Handle wird zur echten Adresse", () => {
    const raw = JSON.stringify({
      blocks: [
        { type: "step", text: "Öffne die Einstellungen.", source: 1 },
        { type: "link", to: "Z1.1", label: "Einstellungen öffnen", source: 1 },
      ],
    });
    const { parts, body } = parseAnswer(raw, SOURCES);
    expect(parts?.[1]).toEqual({
      kind: "link",
      href: "https://app.test/einstellungen",
      label: "Einstellungen öffnen",
      source: 0,
    });
    // Ein Knopf ist kein Fließtext — er gehört nicht in `body`.
    expect(body).toEqual(["Öffne die Einstellungen."]);
  });

  it("Link im Satz wird zu Segmenten; der reine Text bleibt vollständig", () => {
    const raw = JSON.stringify({
      blocks: [
        {
          type: "step",
          text: "Öffne die [Assistenten-Einstellungen](Z1.1) und wähle die Sprache.",
          source: 1,
        },
      ],
    });
    const { parts, body } = parseAnswer(raw, SOURCES);
    expect(parts?.[0]).toMatchObject({
      kind: "step",
      text: "Öffne die Assistenten-Einstellungen und wähle die Sprache.",
      segments: [
        { text: "Öffne die " },
        { text: "Assistenten-Einstellungen", href: "https://app.test/einstellungen" },
        { text: " und wähle die Sprache." },
      ],
    });
    // KOMPATIBILITÄT: `body` ist reiner Text ohne Klammer-Schreibweise.
    expect(body[0]).not.toContain("[");
    expect(body[0]).not.toContain("Z1.1");
  });

  it("erfundenes Handle: KEIN Link, aber auch keine Klammern beim Leser", () => {
    const raw = JSON.stringify({
      blocks: [
        { type: "text", text: "Geh zur [Rechnungsseite](Z9.9).", source: 1 },
        { type: "link", to: "Z9.9", label: "Rechnung öffnen", source: 1 },
      ],
    });
    const { parts, body } = parseAnswer(raw, SOURCES);
    // Der Knopf fällt weg …
    expect(parts?.filter((p) => p.kind === "link")).toEqual([]);
    // … und im Satz bleibt die Beschriftung als normaler Text stehen.
    expect(body[0]).toBe("Geh zur Rechnungsseite.");
    expect(parts?.[0]).not.toHaveProperty("segments");
  });

  it("das Modell darf keine eigene Adresse unterbringen", () => {
    const raw = JSON.stringify({
      blocks: [
        { type: "text", text: "Siehe [hier](https://boese.test).", source: 1 },
        { type: "link", to: "https://boese.test", label: "Hier klicken", source: 1 },
      ],
    });
    const { parts, body } = parseAnswer(raw, SOURCES);
    expect(parts?.filter((p) => p.kind === "link")).toEqual([]);
    expect(JSON.stringify(parts)).not.toContain("boese.test");
    // Auch als unklickbarer Text darf die fremde Adresse nicht stehen
    // bleiben — übrig bleibt die Beschriftung, ohne Klammern.
    expect(body[0]).toBe("Siehe hier.");
  });

  it("Ziele einer ANDEREN Quelle sind nicht erreichbar", () => {
    const raw = JSON.stringify({
      blocks: [{ type: "link", to: "Z2.1", label: "Öffnen", source: 2 }],
    });
    // Quelle 2 hat keine Ziele → kein Knopf, und damit auch keine Antwort.
    expect(parseAnswer(raw, SOURCES).parts).toBeUndefined();
  });
});
