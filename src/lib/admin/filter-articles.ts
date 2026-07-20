import type { AdminArticleRow } from "./types";

/**
 * Client-Filter der Admin-Artikelliste (Suche + Status) — rein und testbar.
 * Die Zeilen sind bereits vollständig geladen (Betreiber-kleine Datenmengen),
 * gefiltert wird ausschließlich im Client (kein Server-Roundtrip).
 */
export function filterArticleRows(
  rows: AdminArticleRow[],
  query: string,
  status: string,
): AdminArticleRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (q === "") return true;
    return r.title.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
  });
}
