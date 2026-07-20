import type { AdminArticleRow } from "./types";

/**
 * TRANSLATION-SETS in der Admin-Artikelliste: Fassungen mit gleichem
 * `articleKey` erscheinen als EIN Eintrag. Primär ist die Fassung in der
 * Instanz-Standardsprache (= das Original, aus dem übersetzt wird); weitere
 * Sprachen hängen als Chips an der Zeile.
 *
 * ÜBERSETZUNGS-STALENESS (bewusst ohne Schema-Änderung): Eine Übersetzung
 * gilt als VERALTET, wenn das Original seit ihrer letzten Bearbeitung
 * geändert wurde (`primary.updatedAt > sibling.updatedAt`). Wer die
 * Übersetzung nachzieht, macht sie damit automatisch wieder frisch.
 * Ohne Original-Fassung (Set ohne Standardsprache) gibt es keine Aussage.
 */

export interface ArticleGroup {
  /** Fassung in der Standardsprache; sonst die älteste Fassung des Sets. */
  primary: AdminArticleRow;
  /** Weitere Sprachfassungen mit Veraltet-Markierung. */
  siblings: { row: AdminArticleRow; stale: boolean }[];
}

export function groupArticleRows(
  rows: AdminArticleRow[],
  defaultLocale: string,
): ArticleGroup[] {
  const byKey = new Map<string, AdminArticleRow[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = row.articleKey || row.id;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(row);
  }

  return order.map((key) => {
    const members = byKey.get(key)!;
    const primary = members.find((m) => m.locale === defaultLocale) ?? members[0];
    const isOriginal = primary.locale === defaultLocale;
    return {
      primary,
      siblings: members
        .filter((m) => m.id !== primary.id)
        .map((row) => ({ row, stale: isOriginal && primary.updatedAt > row.updatedAt })),
    };
  });
}

/**
 * Suche + Status-Filter über GRUPPEN: ein Set bleibt sichtbar, wenn
 * IRGENDEINE Fassung passt (die EN-Fassung eines Treffers gehört zur Zeile —
 * sonst „verschwinden" Übersetzungen mit abweichendem Titel).
 */
export function filterArticleGroups(
  groups: ArticleGroup[],
  query: string,
  status: string,
): ArticleGroup[] {
  const q = query.trim().toLowerCase();
  const matchesText = (r: AdminArticleRow) =>
    q === "" || r.title.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
  const matchesStatus = (r: AdminArticleRow) => status === "all" || r.status === status;

  return groups.filter((g) => {
    const all = [g.primary, ...g.siblings.map((s) => s.row)];
    return all.some(matchesText) && all.some(matchesStatus);
  });
}
