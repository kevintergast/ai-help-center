import { describe, expect, it } from "vitest";
import { parseArticleBody } from "@/lib/content/blocks";
import { groupDestinations } from "./runtime";

/**
 * ZIEL-ÜBERSICHT. Ihr einziger Zweck ist, bei einer geänderten
 * Produkt-Adresse ALLE Stellen zu zeigen. Fällt eine Verwendung heraus,
 * bleibt genau dort ein toter Link stehen — und zwar unbemerkt, weil die
 * Übersicht ja „vollständig" aussah.
 */
describe("groupDestinations", () => {
  const body = (...hrefs: string[]) =>
    parseArticleBody([
      { type: "text", variant: "standard", text: "Ein Schritt." },
      ...hrefs.map((href) => ({
        type: "destination",
        href,
        purpose: `Zweck von ${href} mit genug Text.`,
      })),
    ]);

  it("fasst dieselbe Adresse über Artikel hinweg zusammen", () => {
    const groups = groupDestinations([
      { id: "a1", title: "Erster", body: body("https://e.test/x") },
      { id: "a2", title: "Zweiter", body: body("https://e.test/x", "https://e.test/y") },
    ]);
    expect(groups.map((g) => g.href)).toEqual(["https://e.test/x", "https://e.test/y"]);
    expect(groups[0].uses.map((u) => u.articleId)).toEqual(["a1", "a2"]);
  });

  it("mehrfache Verwendung IM SELBEN Artikel zählt einzeln", () => {
    // Kevins Entscheidung: Inline-Pflege, Dubletten sind in Ordnung. Dann
    // müssen sie hier aber auch alle auftauchen — sonst übersieht man beim
    // Ändern den zweiten Abschnitt.
    const groups = groupDestinations([
      { id: "a1", title: "Erster", body: body("https://e.test/x", "https://e.test/x") },
    ]);
    expect(groups[0].uses).toHaveLength(2);
  });

  it("sortiert nach Häufigkeit — was oft verwendet wird, tut beim Ändern am meisten weh", () => {
    const groups = groupDestinations([
      { id: "a1", title: "A", body: body("https://e.test/selten") },
      { id: "a2", title: "B", body: body("https://e.test/oft") },
      { id: "a3", title: "C", body: body("https://e.test/oft") },
    ]);
    expect(groups[0].href).toBe("https://e.test/oft");
  });

  it("Artikel ohne Ziele kommen nicht vor", () => {
    expect(groupDestinations([{ id: "a1", title: "A", body: body() }])).toEqual([]);
  });
});
