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

/**
 * NEUE BAUSTEINE (2026-08-22, Referenz Zendesk/Intercom): Aufklappbar, Button,
 * Trennlinie, Datei. Verhinderte Fehlerfälle:
 *  - Ein Button-Ziel wie `javascript:…` kommt durch → Skript-Ausführung per
 *    Klick auf einen redaktionell gepflegten Button.
 *  - Aufklappbarer Inhalt landet NICHT im KI-Index → die Antwort auf eine
 *    FAQ-Frage fehlt, obwohl sie im Artikel steht.
 *  - Übersetzung schreibt die Ziel-URL um (Link zeigt danach ins Leere).
 */
describe("neue Block-Typen", () => {
  it("Button: nur https und interne Pfade — Skript-Schemata fliegen raus", () => {
    const ok = (href: string) =>
      validateBodyInput([{ type: "button", label: "Los", href }]).ok;
    expect(ok("https://example.com/app")).toBe(true);
    expect(ok("http://example.com")).toBe(true);
    expect(ok("/konto-erstellen")).toBe(true);
    expect(ok("javascript:alert(1)")).toBe(false);
    expect(ok("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(ok("//fremde-domain.example")).toBe(false);
    expect(ok("mailto:hallo@example.com")).toBe(false);
    expect(ok("")).toBe(false);
  });

  it("Button ohne Beschriftung wird abgelehnt (leerer Klickfleck)", () => {
    const res = validateBodyInput([{ type: "button", label: "  ", href: "/x" }]);
    expect(res).toEqual({ ok: false, error: "invalid_button_label" });
  });

  it("Aufklappbar: Titel ist Pflicht, Inhalt darf leer sein", () => {
    expect(validateBodyInput([{ type: "accordion", title: "Kosten?", text: "" }]).ok).toBe(true);
    expect(validateBodyInput([{ type: "accordion", title: "", text: "Text" }])).toEqual({
      ok: false,
      error: "invalid_accordion_title",
    });
  });

  it("Trennlinie und Datei-Block", () => {
    const res = validateBodyInput([{ type: "divider" }, { type: "file", fileId: "f1" }]);
    expect(res).toEqual({ ok: true, value: [{ type: "divider" }, { type: "file", fileId: "f1" }] });
    expect(validateBodyInput([{ type: "file", fileId: "" }]).ok).toBe(false);
  });

  it("kaputte Blöcke werden beim LESEN verworfen, nicht geworfen", () => {
    const blocks = parseArticleBody([
      { type: "button", label: "Hack", href: "javascript:alert(1)" }, // fliegt raus
      { type: "accordion", title: "Bleibt", text: "Inhalt" },
      { type: "divider" },
    ]);
    expect(blocks).toEqual([
      { type: "accordion", title: "Bleibt", text: "Inhalt" },
      { type: "divider" },
    ]);
  });

  it("KI-Index: Aufklappbares und Button tragen Text bei, Trennlinie/Datei nicht", () => {
    const texts = blockTexts([
      { type: "accordion", title: "Was kostet das?", text: "Ab 29 € im Monat." },
      { type: "button", label: "Zum Konto", href: "/konto" },
      { type: "divider" },
      { type: "file", fileId: "f1" },
    ]);
    expect(texts).toEqual(["Was kostet das?\nAb 29 € im Monat.", "→ Zum Konto: /konto"]);
  });

  it("Übersetzung: Beschriftung und Inhalt ja, Ziel-URL nein", () => {
    const blocks: ArticleBlock[] = [
      { type: "accordion", title: "Kosten", text: "Ab 29 €." },
      { type: "button", label: "Zum Konto", href: "/konto" },
      { type: "divider" },
    ];
    expect(extractTranslatableTexts(blocks)).toEqual(["Kosten", "Ab 29 €.", "Zum Konto"]);
    const translated = applyTranslatedTexts(blocks, ["Costs", "From €29.", "To account"]);
    expect(translated).toEqual([
      { type: "accordion", title: "Costs", text: "From €29." },
      { type: "button", label: "To account", href: "/konto" },
      { type: "divider" },
    ]);
  });

  it("Speicherform: neue Blöcke bleiben Objekte, Standard-Text bleibt String", () => {
    expect(
      serializeBody([
        { type: "text", variant: "standard", text: "Fließtext" },
        { type: "divider" },
      ]),
    ).toEqual(["Fließtext", { type: "divider" }]);
  });
});

/**
 * VERWEIS-GITTER (`articleLinks`). Verhinderte Fehlerfälle:
 *  - Eine Karte im Gitter wird laxer geprüft als eine Einzelkarte → über das
 *    Gitter käme ein Slug wie „../etc" in den Body, den `articleLink` abweist.
 *  - Karten fehlen im Suchindex → die KI kennt die Kachel-Navigation nicht und
 *    kann nicht auf die verlinkten Artikel verweisen.
 *  - Ein leeres Gitter wird gespeichert und rendert als Nichts (unsichtbarer
 *    Block, den niemand im Editor wiederfindet).
 */
describe("articleLinks — Verweis-Gitter", () => {
  const card = (slug: string, title: string) => ({ slug, title, description: "", tag: null });

  it("prüft jede Karte so streng wie eine Einzelkarte", () => {
    const bad = validateBodyInput([
      { type: "articleLinks", items: [card("gut", "Gut"), { slug: "../etc", title: "Böse" }] },
    ]);
    expect(bad).toEqual({ ok: false, error: "invalid_card_slug" });

    const noTitle = validateBodyInput([{ type: "articleLinks", items: [{ slug: "gut", title: "  " }] }]);
    expect(noTitle).toEqual({ ok: false, error: "invalid_card_title" });
  });

  it("lehnt ein leeres Gitter ab (es würde als Nichts rendern)", () => {
    expect(validateBodyInput([{ type: "articleLinks", items: [] }])).toEqual({
      ok: false,
      error: "invalid_card_list",
    });
  });

  it("deckelt die Kartenzahl", () => {
    const many = Array.from({ length: 13 }, (_, i) => card(`ziel-${i}`, `Ziel ${i}`));
    expect(validateBodyInput([{ type: "articleLinks", items: many }])).toEqual({
      ok: false,
      error: "too_many_cards",
    });
  });

  it("nimmt ein gültiges Gitter an und trimmt die Felder", () => {
    const res = validateBodyInput([
      {
        type: "articleLinks",
        items: [
          { slug: " erste-schritte ", title: " Erste Schritte ", description: " Los geht's ", tag: null },
          { slug: "widgets", title: "Widgets", description: "", tag: { text: "Neu", color: "ok" } },
        ],
      },
    ]);
    expect(res).toEqual({
      ok: true,
      value: [
        {
          type: "articleLinks",
          items: [
            { slug: "erste-schritte", title: "Erste Schritte", description: "Los geht's", tag: null },
            { slug: "widgets", title: "Widgets", description: "", tag: { text: "Neu", color: "ok" } },
          ],
        },
      ],
    });
  });

  it("jede Karte landet einzeln im Suchindex", () => {
    const blocks = parseArticleBody([
      {
        type: "articleLinks",
        items: [
          { slug: "a", title: "Widgets", description: "Chat auf der Website" },
          { slug: "b", title: "Prompts" },
        ],
      },
    ]);
    expect(blockTexts(blocks)).toEqual(["→ Widgets: Chat auf der Website", "→ Prompts"]);
  });

  it("verwirft beim Lesen kaputte Karten, statt die Seite zu reißen", () => {
    const blocks = parseArticleBody([
      { type: "articleLinks", items: [{ slug: "a", title: "Gut" }, { nichts: true }, "quatsch"] },
      { type: "articleLinks", items: [] },
    ]);
    expect(blocks).toEqual([
      { type: "articleLinks", items: [{ slug: "a", title: "Gut", description: "", tag: null }] },
    ]);
  });
});
