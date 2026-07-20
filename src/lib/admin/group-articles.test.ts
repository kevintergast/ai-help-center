import { describe, expect, it } from "vitest";
import type { AdminArticleRow } from "./types";
import { filterArticleGroups, groupArticleRows } from "./group-articles";

/**
 * Verhinderte Fehlerfälle:
 *  - DE/EN-Fassungen erscheinen als getrennte Einträge (der gemeldete Bug)
 *    oder die EN-Fassung wird primär statt des Originals.
 *  - Staleness zeigt falsch herum (frische Übersetzung als veraltet bzw.
 *    veraltete als frisch) oder feuert ohne Original-Fassung.
 *  - Suche/Status-Filter verlieren Sets, deren Treffer nur in der
 *    Übersetzung liegt.
 */
const row = (over: Partial<AdminArticleRow>): AdminArticleRow => ({
  id: "a",
  title: "Titel",
  category: "Kat",
  status: "current",
  views: 0,
  helpfulPct: null,
  usedIn: 0,
  updatedLabel: "heute",
  locale: "de",
  articleKey: "k",
  updatedAt: 100,
  ...over,
});

const ROWS: AdminArticleRow[] = [
  // Set 1: DE-Original (neuer) + EN-Übersetzung (älter → veraltet)
  row({ id: "de1", articleKey: "k1", locale: "de", title: "Erste Schritte", updatedAt: 200 }),
  row({
    id: "en1",
    articleKey: "k1",
    locale: "en",
    title: "Getting started",
    status: "draft",
    updatedAt: 150,
  }),
  // Set 2: nur EN in der Liste zuerst — DE-Original folgt später (frisch übersetzt)
  row({ id: "en2", articleKey: "k2", locale: "en", title: "Billing", updatedAt: 300 }),
  row({ id: "de2", articleKey: "k2", locale: "de", title: "Abrechnung", updatedAt: 250 }),
  // Set 3: Einzelartikel ohne Übersetzung
  row({ id: "solo", articleKey: "k3", locale: "de", title: "Solo", updatedAt: 50 }),
];

describe("groupArticleRows", () => {
  it("EIN Eintrag je Set; primär ist die Standardsprache, egal in welcher Reihenfolge", () => {
    const groups = groupArticleRows(ROWS, "de");
    expect(groups.map((g) => g.primary.id)).toEqual(["de1", "de2", "solo"]);
    expect(groups[0].siblings.map((s) => s.row.id)).toEqual(["en1"]);
    expect(groups[1].siblings.map((s) => s.row.id)).toEqual(["en2"]);
    expect(groups[2].siblings).toEqual([]);
  });

  it("Staleness: Original neuer → Übersetzung veraltet; Übersetzung neuer → frisch", () => {
    const groups = groupArticleRows(ROWS, "de");
    expect(groups[0].siblings[0].stale).toBe(true); // de1(200) > en1(150)
    expect(groups[1].siblings[0].stale).toBe(false); // en2(300) > de2(250)
  });

  it("Set OHNE Standardsprache: erste Fassung primär, keine Staleness-Aussage", () => {
    const groups = groupArticleRows(
      [
        row({ id: "en9", articleKey: "k9", locale: "en", updatedAt: 900 }),
        row({ id: "fr9", articleKey: "k9", locale: "fr", updatedAt: 100 }),
      ],
      "de",
    );
    expect(groups[0].primary.id).toBe("en9");
    expect(groups[0].siblings[0].stale).toBe(false);
  });
});

describe("filterArticleGroups", () => {
  const groups = groupArticleRows(ROWS, "de");

  it("Suche trifft auch NUR-übersetzte Titel (Set bleibt sichtbar)", () => {
    expect(filterArticleGroups(groups, "getting", "all").map((g) => g.primary.id)).toEqual([
      "de1",
    ]);
    expect(filterArticleGroups(groups, "abrechnung", "all").map((g) => g.primary.id)).toEqual([
      "de2",
    ]);
  });

  it("Status-Filter: Set passt, wenn IRGENDEINE Fassung passt", () => {
    expect(filterArticleGroups(groups, "", "draft").map((g) => g.primary.id)).toEqual(["de1"]);
    expect(filterArticleGroups(groups, "", "all")).toHaveLength(3);
    expect(filterArticleGroups(groups, "solo", "draft")).toEqual([]);
  });
});
