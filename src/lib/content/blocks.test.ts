import { describe, expect, it } from "vitest";
import {
  applyTranslatedTexts,
  blockTexts,
  extractTranslatableTexts,
  parseArticleBody,
  parseTagInput,
  serializeBody,
  validateBodyInput,
  type ArticleBlock,
} from "./blocks";

/**
 * BLOCK-MODELL. Verhinderte Fehlerfälle:
 *  - HASH-INVARIANTE bricht: Bestands-Artikel (reine String-Bodies) liefern
 *    nach dem Umbau andere Index-Texte → ALLE gespeicherten Antworten kippen
 *    auf „veraltet" und der gesamte Vectorize-Index müsste neu gebaut werden.
 *  - Speicherform driftet (Standard-Text als Objekt statt String) → dasselbe.
 *  - Schreibpfad lässt Müll durch (freie Farben/Varianten → CSS-/UI-Bruch).
 *  - Übersetzung verliert Struktur oder übersetzt Code-Blöcke.
 */

const LEGACY_BODY = [
  "Erster Absatz mit **fett** und [Link](https://example.com).",
  "## Zwischenüberschrift",
  "- Liste\n- mit\n- Punkten",
];

describe("Hash-Invariante für Bestandsdaten", () => {
  it("String-Body → parse → blockTexts liefert EXAKT die Eingabe-Strings", () => {
    expect(blockTexts(parseArticleBody(LEGACY_BODY))).toEqual(LEGACY_BODY);
  });

  it("String-Body → parse → serialize ist BYTE-identisch (Roundtrip)", () => {
    expect(serializeBody(parseArticleBody(LEGACY_BODY))).toEqual(LEGACY_BODY);
    expect(JSON.stringify(serializeBody(parseArticleBody(LEGACY_BODY)))).toBe(
      JSON.stringify(LEGACY_BODY),
    );
  });
});

describe("parseArticleBody (Lesepfad, tolerant)", () => {
  it("mischt Strings und typisierte Blöcke; Müll wird verworfen", () => {
    const parsed = parseArticleBody([
      "Standard",
      { type: "text", variant: "info", text: "Hinweis" },
      { type: "image", imageId: "img-1" },
      { type: "video", videoId: "v-1" },
      { type: "articleLink", slug: "ziel", title: "Ziel", description: "", tag: { text: "Neu", color: "ok" } },
      { type: "kaputt" },
      42,
    ]);
    expect(parsed.map((b) => b.type)).toEqual(["text", "text", "image", "video", "articleLink"]);
    expect(parsed[1]).toMatchObject({ variant: "info" });
  });
});

describe("validateBodyInput (Schreibpfad, streng)", () => {
  it("lehnt freie Varianten/Farben/Slugs ab", () => {
    expect(validateBodyInput([{ type: "text", variant: "fancy", text: "x" }])).toMatchObject({
      ok: false,
      error: "invalid_text_variant",
    });
    expect(
      validateBodyInput([
        { type: "articleLink", slug: "ok-slug", title: "T", description: "", tag: { text: "N", color: "hotpink" } },
      ]),
    ).toMatchObject({ ok: false, error: "invalid_tag" });
    expect(
      validateBodyInput([{ type: "articleLink", slug: "../etc", title: "T", description: "" }]),
    ).toMatchObject({ ok: false, error: "invalid_card_slug" });
  });

  it("akzeptiert das volle Blockspektrum inkl. nackter Strings", () => {
    const res = validateBodyInput([
      "Alt-Text-Absatz",
      { type: "text", variant: "code", text: "npm install" },
      { type: "articleLink", slug: "ziel", title: "Ziel", description: "Kurz", tag: { text: "Neu", color: "brand" } },
    ]);
    expect(res.ok).toBe(true);
  });
});

describe("blockTexts (RAG-/Lesezeit-Ableitung)", () => {
  it("Card → Pfeilzeile; Bild/Video-Blöcke tragen NICHTS bei (Anhänge decken das)", () => {
    const blocks: ArticleBlock[] = [
      { type: "text", variant: "warning", text: "Achtung" },
      { type: "image", imageId: "i1" },
      { type: "video", videoId: "v1" },
      { type: "articleLink", slug: "s", title: "Setup", description: "Erste Schritte", tag: null },
    ];
    expect(blockTexts(blocks)).toEqual(["Achtung", "→ Setup: Erste Schritte"]);
  });
});

describe("Übersetzungs-Helfer (Struktur bleibt, Code bleibt Code)", () => {
  const blocks: ArticleBlock[] = [
    { type: "text", variant: "standard", text: "Hallo" },
    { type: "text", variant: "code", text: "npm run dev" },
    { type: "image", imageId: "i1" },
    { type: "articleLink", slug: "s", title: "Titel", description: "Beschreibung", tag: { text: "Neu", color: "ok" } },
  ];

  it("extract → translate → apply: nur Textfelder ändern sich", () => {
    const texts = extractTranslatableTexts(blocks);
    expect(texts).toEqual(["Hallo", "Titel", "Beschreibung"]);

    const applied = applyTranslatedTexts(blocks, ["Hello", "Title", "Description"]);
    expect(applied[0]).toMatchObject({ text: "Hello" });
    expect(applied[1]).toMatchObject({ variant: "code", text: "npm run dev" }); // unverändert
    expect(applied[2]).toEqual(blocks[2]);
    expect(applied[3]).toMatchObject({ title: "Title", description: "Description", tag: { text: "Neu" } });
  });
});

describe("parseTagInput", () => {
  it("null/leer → null; gültig → Tag; Müll → undefined (Ablehnung)", () => {
    expect(parseTagInput(null)).toBeNull();
    expect(parseTagInput({ text: "  ", color: "ok" })).toBeNull();
    expect(parseTagInput({ text: "Beta", color: "warn" })).toEqual({ text: "Beta", color: "warn" });
    expect(parseTagInput({ text: "Beta", color: "red" })).toBeUndefined();
    expect(parseTagInput({ text: "x".repeat(40), color: "ok" })).toBeUndefined();
  });
});
