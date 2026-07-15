import { describe, expect, it } from "vitest";
import { isSafeHref, parseBlocks, parseInline } from "./simple-markdown";

/**
 * Sicherer Markdown-Parser (Rechtstexte). Verhinderte Fehlerfälle:
 *  - javascript:/data:-Links werden klickbar (XSS-Klassiker) — MÜSSEN Klartext bleiben.
 *  - HTML im Markdown wird als Markup interpretiert (Roh-HTML-Verbot, Design h).
 *  - Struktur-Parsing zerlegt Absätze/Listen falsch (Anzeigefehler in Pflichttexten).
 */

describe("isSafeHref", () => {
  it("erlaubt nur http(s) + mailto", () => {
    expect(isSafeHref("https://example.com/impressum")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("mailto:legal@example.com")).toBe(true);
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,x",
      "/relativ",
      "ftp://x",
      "https://mit leerzeichen",
    ]) {
      expect(isSafeHref(bad)).toBe(false);
    }
  });
});

describe("parseInline", () => {
  it("Link/fett/kursiv/code werden tokenisiert, Text bleibt Text", () => {
    expect(parseInline("Siehe [AGB](https://x.de/agb) und **wichtig** `§5` *kursiv*.")).toEqual([
      { kind: "text", text: "Siehe " },
      { kind: "link", text: "AGB", href: "https://x.de/agb" },
      { kind: "text", text: " und " },
      { kind: "bold", text: "wichtig" },
      { kind: "text", text: " " },
      { kind: "code", text: "§5" },
      { kind: "text", text: " " },
      { kind: "italic", text: "kursiv" },
      { kind: "text", text: "." },
    ]);
  });

  it("unsicherer Link bleibt KLARTEXT (kein link-Token)", () => {
    const tokens = parseInline("Klick [hier](javascript:alert(1)) bitte");
    expect(tokens.some((t) => t.kind === "link")).toBe(false);
    expect(tokens.map((t) => t.text).join("")).toContain("[hier]");
  });

  it("HTML wird NICHT interpretiert — <script> ist gewöhnlicher Text", () => {
    const tokens = parseInline('<script>alert("x")</script>');
    expect(tokens).toEqual([{ kind: "text", text: '<script>alert("x")</script>' }]);
  });
});

describe("parseBlocks", () => {
  it("Überschriften, Absätze (mit Zeilen-Join), Listen und hr", () => {
    const blocks = parseBlocks(
      "# Impressum\n\nZeile eins\nZeile zwei\n\n- Punkt A\n- Punkt B\n\n1. Erstens\n2. Zweitens\n\n---",
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "hr"]);
    expect(blocks[1]).toMatchObject({ inline: [{ kind: "text", text: "Zeile eins Zeile zwei" }] });
    expect(blocks[2]).toMatchObject({ ordered: false });
    expect(blocks[3]).toMatchObject({ ordered: true });
  });

  it("#### (Ebene 4) ist KEINE Überschrift → Absatz (nur 1–3 unterstützt)", () => {
    expect(parseBlocks("#### zu tief")[0].kind).toBe("paragraph");
  });
});
