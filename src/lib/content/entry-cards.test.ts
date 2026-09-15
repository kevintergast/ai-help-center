import { describe, expect, it } from "vitest";
import { entryCardHref, parseEntryCardInput, type EntryCard } from "./entry-cards";

/**
 * EINSTIEGS-KARTEN. Verhinderte Fehlerfälle:
 *  - Ein `javascript:`-Ziel landet als Klickziel auf der Startseite — die
 *    erste Fläche, die jeder Endnutzer sieht.
 *  - Die KI legt über MCP eine Karte an, die ein Mensch im Editor nicht
 *    speichern könnte (oder umgekehrt) → zwei Türen, zwei Wahrheiten.
 *  - Roadmap-Karte trägt zusätzlich ein Ziel → zwei Wahrheiten in EINER Karte,
 *    und beim nächsten Umbau gewinnt die falsche.
 *  - Karte ohne Titel → unsichtbare Klickfläche.
 */

const card = (over: Partial<EntryCard>): EntryCard => ({
  id: "ec_1",
  kind: "article",
  title: "Erste Schritte",
  description: "",
  target: "erste-schritte",
  ...over,
});

describe("parseEntryCardInput", () => {
  it("nimmt eine Artikel-Karte mit Slug an", () => {
    const res = parseEntryCardInput({
      kind: "article",
      title: "  Erste Schritte  ",
      description: " In zehn Minuten startklar ",
      target: "erste-schritte",
    });
    expect(res).toEqual({
      ok: true,
      card: {
        kind: "article",
        title: "Erste Schritte",
        description: "In zehn Minuten startklar",
        target: "erste-schritte",
      },
    });
  });

  it("verwirft Ziele, die keine Slugs sind", () => {
    for (const target of ["/erste-schritte", "Erste Schritte", "https://x.test", "a--b"]) {
      expect(parseEntryCardInput({ kind: "article", title: "T", target })).toEqual({
        ok: false,
        error: "invalid_slug",
      });
    }
  });

  it("lässt bei url NUR https durch", () => {
    expect(parseEntryCardInput({ kind: "url", title: "Status", target: "https://status.test" })).toEqual(
      { ok: true, card: { kind: "url", title: "Status", description: "", target: "https://status.test/" } },
    );
    for (const target of ["http://status.test", "javascript:alert(1)", "data:text/html,x", "//status.test"]) {
      expect(parseEntryCardInput({ kind: "url", title: "Status", target })).toEqual({
        ok: false,
        error: "invalid_url",
      });
    }
  });

  it("wirft bei roadmap/changelog ein mitgeschicktes Ziel weg", () => {
    const res = parseEntryCardInput({ kind: "roadmap", title: "Was kommt", target: "https://evil.test" });
    expect(res).toEqual({
      ok: true,
      card: { kind: "roadmap", title: "Was kommt", description: "", target: "" },
    });
  });

  it("verlangt einen Titel und begrenzt die Längen", () => {
    expect(parseEntryCardInput({ kind: "roadmap", title: "   " })).toEqual({
      ok: false,
      error: "title_required",
    });
    expect(parseEntryCardInput({ kind: "roadmap", title: "x".repeat(81) })).toEqual({
      ok: false,
      error: "title_too_long",
    });
    expect(
      parseEntryCardInput({ kind: "roadmap", title: "T", description: "x".repeat(161) }),
    ).toEqual({ ok: false, error: "description_too_long" });
  });

  it("verlangt bei article/url ein Ziel und lehnt unbekannte Arten ab", () => {
    expect(parseEntryCardInput({ kind: "article", title: "T" })).toEqual({
      ok: false,
      error: "target_required",
    });
    expect(parseEntryCardInput({ kind: "video", title: "T" })).toEqual({
      ok: false,
      error: "invalid_kind",
    });
    expect(parseEntryCardInput(null)).toEqual({ ok: false, error: "invalid_kind" });
  });
});

describe("entryCardHref", () => {
  it("führt Artikel auf den Slug und url nach außen", () => {
    expect(entryCardHref(card({}))).toBe("/erste-schritte");
    expect(entryCardHref(card({ kind: "url", target: "https://status.test/" }))).toBe(
      "https://status.test/",
    );
  });

  it("liefert für roadmap/changelog kein Ziel (Drill-Down statt Seite)", () => {
    expect(entryCardHref(card({ kind: "roadmap", target: "" }))).toBeNull();
    expect(entryCardHref(card({ kind: "changelog", target: "" }))).toBeNull();
  });
});
