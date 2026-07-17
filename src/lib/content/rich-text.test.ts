import { describe, expect, it } from "vitest";
import { blocksToDoc, docToBlocks, type DocNode } from "./rich-doc";
import { blockToString, isSafeHref, parseBlock, parseInline } from "./rich-text";

/**
 * RICH-TEXT-SUBSET (Tiptap-Editor). Verhinderte Fehlerfälle:
 *  - Unsichere Links (javascript:/data:) überleben als klickbares Ziel → XSS.
 *  - Roundtrip blocks→doc→blocks verliert/verfälscht Struktur → beim ersten
 *    Editor-Speichern kippen ALLE Chunk-Hashes → Massen-„Veraltet".
 *  - Reine Text-Absätze (Alt-Bestand) werden nicht mehr als solche erkannt.
 */

describe("parseInline — Marks + Link-Sicherheit", () => {
  it("erkennt bold/italic/code/link", () => {
    expect(parseInline("ganz **fett** und *kursiv*")).toEqual([
      { kind: "text", text: "ganz " },
      { kind: "bold", children: [{ kind: "text", text: "fett" }] },
      { kind: "text", text: " und " },
      { kind: "italic", children: [{ kind: "text", text: "kursiv" }] },
    ]);
    expect(parseInline("siehe [Doku](https://example.com)")).toEqual([
      { kind: "text", text: "siehe " },
      { kind: "link", href: "https://example.com", children: [{ kind: "text", text: "Doku" }] },
    ]);
  });

  it("unsicheres Link-Ziel → nur Text (kein klickbarer javascript:/data:-Link)", () => {
    expect(parseInline("[klick](javascript:alert(1))")).toEqual([
      { kind: "text", text: "klick" },
    ]);
    expect(parseInline("[x](data:text/html,<script>)")).toEqual([{ kind: "text", text: "x" }]);
    expect(isSafeHref("https://ok.example")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("/relativ")).toBe(false);
  });

  it("nicht schließbare Marker bleiben literal (keine kaputte Struktur)", () => {
    expect(parseInline("2 ** 3 = 8")).toEqual([{ kind: "text", text: "2 ** 3 = 8" }]);
  });
});

describe("parseBlock — Blocktypen", () => {
  it("h2/h3/ul/ol/quote/code + Absatz", () => {
    expect(parseBlock("## Titel").kind).toBe("h2");
    expect(parseBlock("### Unter").kind).toBe("h3");
    expect(parseBlock("- a\n- b")).toMatchObject({ kind: "ul", items: expect.any(Array) });
    expect(parseBlock("1. a\n2. b").kind).toBe("ol");
    expect(parseBlock("> zitat").kind).toBe("quote");
    expect(parseBlock("```\ncode\n```")).toEqual({ kind: "code", text: "code" });
    expect(parseBlock("nur text").kind).toBe("p");
  });

  it("reiner Text-Absatz (Alt-Bestand) bleibt Absatz mit identischem String", () => {
    const block = "Ein ganz normaler Absatz ohne Formatierung.";
    expect(blockToString(parseBlock(block))).toBe(block);
  });
});

describe("Roundtrip blocks → doc → blocks (Hash-Stabilität)", () => {
  const cases: string[][] = [
    ["Nur ein Absatz."],
    ["## Überschrift", "Ein Absatz mit **fett** und *kursiv* und `code`."],
    ["### Unterüberschrift", "- Punkt eins\n- Punkt zwei", "1. Erstens\n2. Zweitens"],
    ["> Ein Zitat", "```\nconst x = 1;\n```"],
    ["Link im Text: [Doku](https://example.com/pfad) danach mehr."],
    ["Mehrere\nZeilen\nim Absatz"],
  ];

  it.each(cases)("stabil: %#", (...blocks) => {
    const roundtripped = docToBlocks(blocksToDoc(blocks));
    // Absatz-interne Zeilenumbrüche normalisieren sich zu Leerzeichen (wie im
    // Renderer) — deshalb gegen die parseBlock-normalisierte Form vergleichen,
    // nicht gegen die Rohform. Zweiter Roundtrip MUSS fixpunkt sein.
    const normalized = blocks.map((b) => blockToString(parseBlock(b)));
    expect(roundtripped).toEqual(normalized);
    expect(docToBlocks(blocksToDoc(roundtripped))).toEqual(normalized);
  });

  it("unsicherer Link überlebt den Editor-Roundtrip NICHT als Link", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "klick",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    };
    expect(docToBlocks(doc)).toEqual(["klick"]);
  });
});
