import { describe, expect, it } from "vitest";
import type { AdminArticleRow } from "./types";
import { filterArticleRows } from "./filter-articles";

/**
 * Verhinderter Fehlerfall (der frühere Scaffold-Bug in neu): Suchfeld/Filter
 * sehen funktional aus, filtern aber falsch — z. B. Status-Filter zeigt
 * fremde Status, Suche findet Kategorien nicht oder ist case-sensitiv.
 */
const row = (over: Partial<AdminArticleRow>): AdminArticleRow => ({
  id: "a",
  title: "Titel",
  category: "Kategorie",
  status: "current",
  views: 0,
  helpfulPct: null,
  usedIn: 0,
  updatedLabel: "heute",
  ...over,
});

const ROWS = [
  row({ id: "1", title: "Erste Schritte", category: "Start", status: "current" }),
  row({ id: "2", title: "Widget einbinden", category: "Integration", status: "draft" }),
  row({ id: "3", title: "KI-Antworten", category: "Start", status: "ai" }),
];

describe("filterArticleRows", () => {
  it("Status-Filter exakt; 'all' zeigt alles", () => {
    expect(filterArticleRows(ROWS, "", "all").map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(filterArticleRows(ROWS, "", "draft").map((r) => r.id)).toEqual(["2"]);
    expect(filterArticleRows(ROWS, "", "stale")).toEqual([]);
  });

  it("Suche über Titel UND Kategorie, case-insensitiv, kombiniert mit Status", () => {
    expect(filterArticleRows(ROWS, "WIDGET", "all").map((r) => r.id)).toEqual(["2"]);
    expect(filterArticleRows(ROWS, "start", "all").map((r) => r.id)).toEqual(["1", "3"]);
    expect(filterArticleRows(ROWS, "start", "ai").map((r) => r.id)).toEqual(["3"]);
    expect(filterArticleRows(ROWS, "  ", "all").length).toBe(3); // nur Whitespace = keine Suche
  });
});
