import { describe, expect, it } from "vitest";
import type { ArticleSummary } from "@/lib/content/types";
import {
  dropArticle,
  dropCategory,
  flatten,
  isDirty,
  moveArticle,
  moveCategory,
  toGroups,
} from "./nav-order";

/**
 * NAVIGATIONS-REIHENFOLGE. Verhinderte Fehlerfälle:
 *  - Ein Artikel rutscht beim Verschieben über die Kategoriegrenze und wechselt
 *    damit stillschweigend die Kategorie (Sortierung ≠ Umkategorisierung).
 *  - Eine Kategorie wird verschoben und lässt einzelne Artikel zurück —
 *    die Kategorie stünde dann zweimal in der Leiste.
 *  - Eine Verschiebung am Rand kippt die Liste oder verliert Einträge.
 */

const a = (id: string, category: string): ArticleSummary => ({
  id,
  slug: id,
  title: id.toUpperCase(),
  category,
  status: "current",
  updatedLabel: "",
});

// Kategorie A: a1 a2 a3 | Kategorie B: b1 b2
const LIST = [a("a1", "A"), a("a2", "A"), a("a3", "A"), a("b1", "B"), a("b2", "B")];
const ids = (l: ArticleSummary[]) => l.map((x) => x.id).join(" ");

describe("toGroups / flatten", () => {
  it("gruppiert nach erstem Auftreten und ist verlustfrei umkehrbar", () => {
    const groups = toGroups(LIST);
    expect(groups.map((g) => g.category)).toEqual(["A", "B"]);
    expect(groups[0].articles.map((x) => x.id)).toEqual(["a1", "a2", "a3"]);
    expect(ids(flatten(groups))).toBe(ids(LIST));
  });

  it("hält eine unterbrochene Kategorie zusammen (kein zweiter Block)", () => {
    const mixed = [a("a1", "A"), a("b1", "B"), a("a2", "A")];
    const groups = toGroups(mixed);
    expect(groups.map((g) => g.category)).toEqual(["A", "B"]);
    expect(groups[0].articles.map((x) => x.id)).toEqual(["a1", "a2"]);
  });
});

describe("moveArticle", () => {
  it("verschiebt innerhalb der Kategorie", () => {
    expect(ids(moveArticle(LIST, "a2", -1))).toBe("a2 a1 a3 b1 b2");
    expect(ids(moveArticle(LIST, "a2", 1))).toBe("a1 a3 a2 b1 b2");
  });

  it("verschiebt NICHT über die Kategoriegrenze", () => {
    // a3 ist der letzte in A — „runter" darf ihn nicht nach B schieben.
    expect(ids(moveArticle(LIST, "a3", 1))).toBe(ids(LIST));
    // b1 ist der erste in B — „hoch" darf ihn nicht nach A schieben.
    expect(ids(moveArticle(LIST, "b1", -1))).toBe(ids(LIST));
  });

  it("ignoriert unbekannte Ids", () => {
    expect(ids(moveArticle(LIST, "nope", 1))).toBe(ids(LIST));
  });
});

describe("moveCategory", () => {
  it("verschiebt die Kategorie samt aller Artikel", () => {
    expect(ids(moveCategory(LIST, "B", -1))).toBe("b1 b2 a1 a2 a3");
  });

  it("tut am Rand nichts", () => {
    expect(ids(moveCategory(LIST, "A", -1))).toBe(ids(LIST));
    expect(ids(moveCategory(LIST, "B", 1))).toBe(ids(LIST));
  });
});

describe("dropArticle", () => {
  it("setzt den gezogenen Artikel an die Stelle des Ziels", () => {
    expect(ids(dropArticle(LIST, "a1", "a3"))).toBe("a2 a3 a1 b1 b2");
    expect(ids(dropArticle(LIST, "a3", "a1"))).toBe("a3 a1 a2 b1 b2");
  });

  it("verwirft einen Zug über die Kategoriegrenze", () => {
    expect(ids(dropArticle(LIST, "a1", "b2"))).toBe(ids(LIST));
  });

  it("auf sich selbst ist ein No-op", () => {
    expect(ids(dropArticle(LIST, "a1", "a1"))).toBe(ids(LIST));
  });
});

describe("dropCategory", () => {
  it("zieht eine Kategorie vor eine andere", () => {
    expect(ids(dropCategory(LIST, "B", "A"))).toBe("b1 b2 a1 a2 a3");
  });
});

describe("isDirty", () => {
  it("erkennt nur echte Reihenfolge-Änderungen", () => {
    expect(isDirty(LIST, [...LIST])).toBe(false);
    expect(isDirty(LIST, moveArticle(LIST, "a1", 1))).toBe(true);
  });
});
