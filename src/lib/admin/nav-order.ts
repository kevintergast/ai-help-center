import type { ArticleSummary } from "@/lib/content/types";

/**
 * REIHENFOLGE-LOGIK der Navigations-Pflege (Migration 0034).
 *
 * Hier liegt die reine Rechnung, damit sie ohne DOM, ohne Drag-Ereignisse und
 * ohne React prüfbar ist — die Oberfläche (admin/nav-order-manager.tsx) hält
 * nur noch eine flache Liste und ruft diese Funktionen.
 *
 * DAS MODELL IST EINE FLACHE LISTE. Kategorien sind KEINE eigene Ebene mit
 * eigener Position, sondern das Ergebnis daraus, wo ihr erster Artikel steht
 * (genau wie `groupByCategory` im Lesepfad). Zwei Ebenen mit getrennten
 * Positionen könnten auseinanderlaufen — eine kann das nicht.
 *
 * KATEGORIEN BLEIBEN GESCHLOSSEN: Jede Verschiebung hält die Artikel einer
 * Kategorie zusammen. Ein Artikel in eine fremde Kategorie zu ziehen wäre
 * keine Sortierung mehr, sondern eine Umkategorisierung — die gehört in den
 * Artikel-Editor, wo sie benannt und gespeichert wird.
 */

export interface OrderGroup {
  category: string;
  articles: ArticleSummary[];
}

/** Flache Liste → Gruppen in der Reihenfolge ihres ersten Auftretens. */
export function toGroups(list: ArticleSummary[]): OrderGroup[] {
  const order: string[] = [];
  const byCat = new Map<string, ArticleSummary[]>();
  for (const a of list) {
    if (!byCat.has(a.category)) {
      byCat.set(a.category, []);
      order.push(a.category);
    }
    byCat.get(a.category)!.push(a);
  }
  return order.map((category) => ({ category, articles: byCat.get(category)! }));
}

/** Gruppen → flache Liste (die Form, die gespeichert wird). */
export function flatten(groups: OrderGroup[]): ArticleSummary[] {
  return groups.flatMap((g) => g.articles);
}

/**
 * Einen Artikel INNERHALB seiner Kategorie um eine Position verschieben.
 * Am Rand der Kategorie passiert nichts — der Artikel rutscht NICHT in die
 * Nachbarkategorie (das wäre eine Umkategorisierung, s. oben).
 */
export function moveArticle(
  list: ArticleSummary[],
  id: string,
  direction: -1 | 1,
): ArticleSummary[] {
  const groups = toGroups(list);
  const group = groups.find((g) => g.articles.some((a) => a.id === id));
  if (!group) return list;

  const from = group.articles.findIndex((a) => a.id === id);
  const to = from + direction;
  if (to < 0 || to >= group.articles.length) return list;

  const articles = [...group.articles];
  [articles[from], articles[to]] = [articles[to], articles[from]];
  return flatten(groups.map((g) => (g.category === group.category ? { ...g, articles } : g)));
}

/** Eine GANZE Kategorie (mit allen Artikeln) um eine Position verschieben. */
export function moveCategory(
  list: ArticleSummary[],
  category: string,
  direction: -1 | 1,
): ArticleSummary[] {
  const groups = toGroups(list);
  const from = groups.findIndex((g) => g.category === category);
  if (from === -1) return list;

  const to = from + direction;
  if (to < 0 || to >= groups.length) return list;

  const next = [...groups];
  [next[from], next[to]] = [next[to], next[from]];
  return flatten(next);
}

/**
 * Ziehen und fallen lassen: `draggedId` landet an der Stelle von `targetId`.
 * Nur innerhalb DERSELBEN Kategorie — ein Zug über die Kategoriegrenze wird
 * verworfen und lässt die Liste unverändert.
 */
export function dropArticle(
  list: ArticleSummary[],
  draggedId: string,
  targetId: string,
): ArticleSummary[] {
  if (draggedId === targetId) return list;
  const groups = toGroups(list);
  const group = groups.find((g) => g.articles.some((a) => a.id === draggedId));
  if (!group || !group.articles.some((a) => a.id === targetId)) return list;

  const from = group.articles.findIndex((a) => a.id === draggedId);
  const to = group.articles.findIndex((a) => a.id === targetId);
  const articles = [...group.articles];
  const [moved] = articles.splice(from, 1);
  articles.splice(to, 0, moved);
  return flatten(groups.map((g) => (g.category === group.category ? { ...g, articles } : g)));
}

/** Eine Kategorie vor eine andere ziehen (Gruppen-Ebene). */
export function dropCategory(
  list: ArticleSummary[],
  dragged: string,
  target: string,
): ArticleSummary[] {
  if (dragged === target) return list;
  const groups = toGroups(list);
  const from = groups.findIndex((g) => g.category === dragged);
  const to = groups.findIndex((g) => g.category === target);
  if (from === -1 || to === -1) return list;

  const next = [...groups];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return flatten(next);
}

/** Hat sich gegenüber dem geladenen Stand etwas geändert? */
export function isDirty(a: ArticleSummary[], b: ArticleSummary[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((x, i) => x.id !== b[i].id);
}
