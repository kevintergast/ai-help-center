import { describe, expect, it } from "vitest";
import type { Article } from "./types";
import { fold, highlight, searchArticles, snippetAround, terms } from "./search";

/**
 * VOLLTEXT-SUCHE. Verhinderte Fehlerfälle:
 *  - Die Suche findet weiter nur Titel — wer sich an eine Formulierung IM
 *    Artikel erinnert, findet ihn nicht (der Anlass für dieses Modul).
 *  - Überlappende Treffer erzeugen verschachtelte Markierungen, die sich nicht
 *    rendern lassen.
 *  - Ein Artikel, der den Begriff beiläufig im Fließtext hat, steht vor dem,
 *    der ihn im Titel trägt.
 *  - Zwei Suchwörter verhalten sich als ODER — dann filtert Tippen nicht.
 *  - Der Ausschnitt schneidet mitten im Wort oder behauptet eine Fundstelle,
 *    wo nur der Titel passte.
 */

const article = (over: Partial<Article>): Article => ({
  id: "a1",
  slug: "a1",
  title: "Titel",
  category: "Kategorie",
  status: "current",
  updatedLabel: "",
  readingMinutes: 1,
  body: [],
  videos: [],
  relatedIds: [],
  ...over,
});

const text = (t: string) => ({ type: "text" as const, variant: "standard" as const, text: t });

describe("fold / terms", () => {
  it("ignoriert Groß-/Kleinschreibung und Diakritika", () => {
    expect(fold("Übersetzung")).toBe("ubersetzung");
    expect(fold("ÉCOLE")).toBe("ecole");
  });

  it("zerlegt die Anfrage und wirft Leeres und Doppeltes weg", () => {
    expect(terms("  Sprache   sprache  Kontakt ")).toEqual(["sprache", "kontakt"]);
    expect(terms("   ")).toEqual([]);
  });
});

describe("highlight", () => {
  it("markiert jede Fundstelle, auch mehrfach", () => {
    const segs = highlight("Sprache und Sprache", ["sprache"]);
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["Sprache", "Sprache"]);
    expect(segs.map((s) => s.text).join("")).toBe("Sprache und Sprache");
  });

  it("verschmilzt überlappende Treffer statt sie zu verschachteln", () => {
    const segs = highlight("Sprachkurs", ["sprach", "sprachkurs"]);
    expect(segs).toEqual([{ text: "Sprachkurs", match: true }]);
  });

  it("lässt Text ohne Treffer unangetastet", () => {
    expect(highlight("nichts hier", ["xyz"])).toEqual([{ text: "nichts hier", match: false }]);
  });
});

describe("snippetAround", () => {
  it("schneidet um den ersten Treffer und markiert ihn", () => {
    const body = `${"Vorlauf ".repeat(20)}Ausgabesprache der Variable ${"Nachlauf ".repeat(30)}`;
    const segs = snippetAround(body, ["sprache"]);
    const joined = segs.map((s) => s.text).join("");
    expect(joined).toContain("sprache");
    expect(joined.length).toBeLessThan(body.length);
    expect(segs.some((s) => s.match)).toBe(true);
    // Gekürzt an beiden Enden → Auslassungszeichen.
    expect(joined.startsWith("… ")).toBe(true);
    expect(joined.endsWith(" …")).toBe(true);
  });

  it("liefert NICHTS, wenn der Körper den Begriff nicht enthält", () => {
    expect(snippetAround("ganz anderer Text", ["sprache"])).toEqual([]);
  });
});

describe("searchArticles", () => {
  const ARTICLES = [
    article({ id: "titel", slug: "sprache", title: "Sprache", category: "Wissen" }),
    article({
      id: "koerper",
      slug: "anrufanalyse",
      title: "Anrufanalyse",
      category: "Automatisierung",
      body: [text("Für Ja/Nein-Ergebnisse eignet sich der Typ Zahl. Ausgabesprache der Variable.")],
    }),
    article({ id: "fremd", slug: "branding", title: "Branding", category: "Aussehen" }),
  ];

  it("findet auch, was nur im INHALT steht — der Anlass für das Modul", () => {
    const hits = searchArticles(ARTICLES, "sprache");
    expect(hits.map((h) => h.id)).toEqual(["titel", "koerper"]);
    const koerper = hits.find((h) => h.id === "koerper")!;
    expect(koerper.snippet.some((s) => s.match)).toBe(true);
  });

  it("Titel schlägt Körper", () => {
    expect(searchArticles(ARTICLES, "sprache")[0].id).toBe("titel");
  });

  it("Der Titel-Treffer hat KEINEN Körper-Ausschnitt (keine erfundene Fundstelle)", () => {
    const hit = searchArticles(ARTICLES, "sprache").find((h) => h.id === "titel")!;
    expect(hit.snippet).toEqual([]);
    expect(hit.titleSegments.some((s) => s.match)).toBe(true);
  });

  it("mehrere Wörter wirken als UND", () => {
    expect(searchArticles(ARTICLES, "sprache zahl").map((h) => h.id)).toEqual(["koerper"]);
    expect(searchArticles(ARTICLES, "sprache gibtesnicht")).toEqual([]);
  });

  it("leere Anfrage findet nichts (statt alles)", () => {
    expect(searchArticles(ARTICLES, "   ")).toEqual([]);
  });

  it("achtet den Deckel", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      article({ id: `x${i}`, slug: `x${i}`, title: `Sprache ${i}` }),
    );
    expect(searchArticles(many, "sprache")).toHaveLength(12);
  });
});
