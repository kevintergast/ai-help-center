import { describe, expect, it } from "vitest";
import { parseBlocks } from "./rich-text";
import { uniqueAnchorId } from "./heading-anchor";
import { articleHeadings, inlineText, textToParagraphs } from "./headings";
import type { ArticleBlock } from "./blocks";

/**
 * Verhinderter Fehlerfall: Das Inhaltsverzeichnis verlinkt `#id`, der Renderer
 * setzt `id` — laufen die beiden Herleitungen auseinander, zeigen ALLE
 * Sprungmarken ins Leere (und das fällt im Test-Grün nicht auf). Der letzte
 * Test hier spielt darum den Renderer-Weg nach und vergleicht die Ids.
 */

const text = (t: string, variant: "standard" | "info" | "code" = "standard"): ArticleBlock => ({
  type: "text",
  variant,
  text: t,
});

describe("articleHeadings", () => {
  it("liefert h2/h3 in Dokumentreihenfolge mit Anker-Ids", () => {
    const blocks: ArticleBlock[] = [
      text("## Erste Schritte\n\nEinleitung."),
      { type: "image", imageId: "img1" },
      text("### Konto anlegen", "info"),
      text("## Fertig"),
    ];
    expect(articleHeadings(blocks)).toEqual([
      { level: 2, text: "Erste Schritte", id: "erste-schritte" },
      { level: 3, text: "Konto anlegen", id: "konto-anlegen" },
      { level: 2, text: "Fertig", id: "fertig" },
    ]);
  });

  it("überspringt Code-Blöcke (dort ist ## kein Titel, sondern Code)", () => {
    expect(articleHeadings([text("## Echt"), text("## Nur Code", "code")])).toEqual([
      { level: 2, text: "Echt", id: "echt" },
    ]);
  });

  it("macht doppelte Überschriften eindeutig", () => {
    const ids = articleHeadings([text("## Hinweise"), text("## Hinweise")]).map((h) => h.id);
    expect(ids).toEqual(["hinweise", "hinweise-2"]);
  });

  it("nimmt Auszeichnungen aus dem Titel-Text (Id bleibt lesbar)", () => {
    expect(articleHeadings([text("## **Wichtig** für `alle`")])[0]).toEqual({
      level: 2,
      text: "Wichtig für alle",
      id: "wichtig-fuer-alle",
    });
  });

  it("ohne Überschriften: leere Liste (kein Inhaltsverzeichnis)", () => {
    expect(articleHeadings([text("Nur ein Absatz."), { type: "divider" }])).toEqual([]);
  });

  it("Ids sind IDENTISCH mit dem Renderer-Weg (Sprungmarken treffen)", () => {
    const blocks: ArticleBlock[] = [
      text("## Setup\n\nText.\n\n### Details"),
      text("## Setup", "info"), // Dublette über Blockgrenze hinweg
      text("### Details\n\nMehr."),
    ];
    // So vergibt RichTextView die Ids: ein geteiltes `taken`-Set über alle
    // Blöcke, Absatz-Splittung per textToParagraphs, Titel per inlineText.
    const taken = new Set<string>();
    const rendered: string[] = [];
    for (const b of blocks) {
      if (b.type !== "text" || b.variant === "code") continue;
      for (const parsed of parseBlocks(textToParagraphs(b.text))) {
        if (parsed.kind === "h2" || parsed.kind === "h3") {
          rendered.push(uniqueAnchorId(inlineText(parsed.inline), taken));
        }
      }
    }
    expect(articleHeadings(blocks).map((h) => h.id)).toEqual(rendered);
    expect(rendered).toEqual(["setup", "details", "setup-2", "details-2"]);
  });
});
