import type { Article } from "./types";
import { blockTexts } from "./blocks";

/**
 * VOLLTEXT-SUCHE über die Artikel des Hilfezentrums.
 *
 * WARUM CLIENT-SEITIG: Das Lese-Bundle (`HelpCenterData.articles`) enthält
 * ohnehin schon ALLE veröffentlichten Artikel samt Körper — sie sind für die
 * Detailansicht da. Eine Server-Suche würde dieselben Daten ein zweites Mal
 * holen und jeden Tastendruck zu einem Rundlauf machen. Bei der Größe eines
 * Hilfezentrums (Dutzende bis wenige hundert Artikel) ist die Suche im
 * Speicher schneller als jede Anfrage und funktioniert auch offline weiter.
 *
 * WAS SIE KANN (und warum):
 *  - Titel UND Inhalt. Vorher nur Titel und Kategorie — wer sich an eine
 *    Formulierung IM Artikel erinnert, fand ihn nicht.
 *  - Mehrere Wörter = UND. „sprache kontakt" findet nur, was beides enthält;
 *    das ist die Erwartung aus jeder Suchleiste.
 *  - Diakritika-tolerant: „uebersetzung", „übersetzung" und „Ubersetzung"
 *    finden dasselbe.
 *  - Textausschnitt um den ersten Treffer im Körper, mit markierten Stellen —
 *    damit man VOR dem Klick sieht, warum ein Artikel gefunden wurde.
 *
 * WAS SIE BEWUSST NICHT KANN: Stammformen („Sprachen" findet „Sprache" nur
 * über den Präfix), Tippfehler-Toleranz, Synonyme. Dafür gibt es die
 * KI-Antwort daneben — sie ist der semantische Weg. Die Suchleiste ist der
 * wörtliche, und wörtlich heißt vorhersagbar.
 */

export interface SearchSegment {
  text: string;
  /** true = Teil des Suchbegriffs → in der Oberfläche hervorgehoben. */
  match: boolean;
}

export interface SearchHit {
  id: string;
  slug: string;
  title: string;
  category: string;
  /** Titel in Segmenten (Treffer markiert). */
  titleSegments: SearchSegment[];
  /** Ausschnitt aus dem Körper; leer, wenn nur der Titel passte. */
  snippet: SearchSegment[];
}

/** Zeichen um den Treffer herum im Ausschnitt. */
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 120;
export const MAX_SEARCH_HITS = 12;

/**
 * Vergleichsform: klein, ohne Diakritika. `NFD` zerlegt „ü" in „u" +
 * Trema, die Bereinigung wirft das Trema weg — so greift „ubersetzung" auch
 * bei „Übersetzung". Die deutsche Umschrift (ü→ue) bleibt bewusst außen vor:
 * sie würde „Auerbach" zu „Auerbach" und „Äußerung" zu „Aeusserung" machen und
 * damit mehr Verwirrung stiften, als sie löst.
 */
export function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Anfrage → Suchwörter (leere und doppelte raus). */
export function terms(query: string): string[] {
  const out: string[] = [];
  for (const raw of fold(query).split(/\s+/)) {
    const t = raw.trim();
    if (t.length > 0 && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Text in Segmente zerlegen, in denen die Suchwörter markiert sind.
 * Überlappende Treffer werden verschmolzen — sonst entstünden verschachtelte
 * Markierungen, die im Markup nicht darstellbar sind.
 */
export function highlight(text: string, words: string[]): SearchSegment[] {
  if (words.length === 0 || text.length === 0) return [{ text, match: false }];
  const haystack = fold(text);

  const spans: [number, number][] = [];
  for (const w of words) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(w, from);
      if (at === -1) break;
      spans.push([at, at + w.length]);
      from = at + w.length;
    }
  }
  if (spans.length === 0) return [{ text, match: false }];

  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [spans[0]];
  for (const [start, end] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const out: SearchSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) out.push({ text: text.slice(cursor, start), match: false });
    out.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), match: false });
  return out;
}

/**
 * Ausschnitt um den ERSTEN Treffer. Ohne Treffer im Körper: leer — dann passte
 * nur der Titel, und ein beliebiger Textanfang als „Fundstelle" auszugeben
 * wäre irreführend.
 */
export function snippetAround(body: string, words: string[]): SearchSegment[] {
  const haystack = fold(body);
  let first = -1;
  for (const w of words) {
    const at = haystack.indexOf(w);
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }
  if (first === -1) return [];

  let start = Math.max(0, first - SNIPPET_BEFORE);
  let end = Math.min(body.length, first + SNIPPET_AFTER);
  // Nicht mitten im Wort anfangen/aufhören.
  if (start > 0) {
    const space = body.indexOf(" ", start);
    if (space !== -1 && space < first) start = space + 1;
  }
  if (end < body.length) {
    const space = body.lastIndexOf(" ", end);
    if (space > first) end = space;
  }

  const segments = highlight(body.slice(start, end), words);
  if (start > 0) segments.unshift({ text: "… ", match: false });
  if (end < body.length) segments.push({ text: " …", match: false });
  return segments;
}

/** Ein Artikel als durchsuchbarer Fließtext (Titel bleibt separat). */
function bodyText(article: Article): string {
  return blockTexts(article.body).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Rang: Titel schlägt Kategorie schlägt Körper, und ein Treffer am
 * WORTANFANG schlägt einen mitten im Wort. Ohne diese Abstufung stünde ein
 * Artikel, der den Begriff beiläufig im Fließtext erwähnt, neben dem, der ihn
 * im Titel trägt.
 */
function score(word: string, title: string, category: string, body: string): number {
  const t = fold(title);
  const c = fold(category);
  const b = fold(body);

  if (t === word) return 1000;
  if (t.startsWith(word)) return 400;
  if (new RegExp(`\\b${escapeRe(word)}`).test(t)) return 300;
  if (t.includes(word)) return 200;
  if (c.includes(word)) return 120;
  if (new RegExp(`\\b${escapeRe(word)}`).test(b)) return 60;
  if (b.includes(word)) return 30;
  return 0;
}

function escapeRe(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Artikel suchen. Leere Anfrage → leere Liste (die Oberfläche zeigt dann ihre
 * eigene Voreinstellung, nicht „alle Artikel als Treffer").
 */
export function searchArticles(
  articles: Article[],
  query: string,
  limit = MAX_SEARCH_HITS,
): SearchHit[] {
  const words = terms(query);
  if (words.length === 0) return [];

  const scored: { hit: SearchHit; rank: number }[] = [];
  for (const a of articles) {
    const body = bodyText(a);
    let total = 0;
    // UND-Verknüpfung: JEDES Wort muss irgendwo vorkommen.
    for (const w of words) {
      const s = score(w, a.title, a.category, body);
      if (s === 0) {
        total = 0;
        break;
      }
      total += s;
    }
    if (total === 0) continue;

    scored.push({
      rank: total,
      hit: {
        id: a.id,
        slug: a.slug,
        title: a.title,
        category: a.category,
        titleSegments: highlight(a.title, words),
        snippet: snippetAround(body, words),
      },
    });
  }

  // Gleicher Rang → alphabetisch, damit die Reihenfolge nicht bei jedem
  // Tastendruck springt.
  scored.sort((x, y) => y.rank - x.rank || x.hit.title.localeCompare(y.hit.title));
  return scored.slice(0, limit).map((s) => s.hit);
}

/**
 * Längentreue Faltung: Jedes Zeichen wird EINZELN entkleidet, damit die
 * Positionen im Ergebnis exakt denen im Original entsprechen.
 *
 * `fold()` oben darf den Text kürzen (NFD zerlegt „ü" in zwei Zeichen, das
 * Trema fällt weg) — fürs Vergleichen ist das egal. Zum MARKIEREN im
 * Artikeltext ist es fatal: Jede Verschiebung um ein Zeichen setzt die
 * Markierung woanders hin. Deshalb hier die Variante, die die Länge hält.
 */
export function foldAligned(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const f = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    // Nur übernehmen, wenn genau EIN Zeichen herauskommt — sonst bliebe die
    // Länge nicht erhalten (etwa bei Ligaturen).
    out += f.length === 1 ? f : c.toLowerCase();
  }
  return out;
}

/** Fundstellen eines Wortes in einem Text (Positionen im ORIGINAL). */
export function findRanges(text: string, words: string[]): [number, number][] {
  const haystack = foldAligned(text);
  const spans: [number, number][] = [];
  for (const w of words) {
    if (w.length === 0) continue;
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(w, from);
      if (at === -1) break;
      spans.push([at, at + w.length]);
      from = at + w.length;
    }
  }
  if (spans.length === 0) return [];
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [spans[0]];
  for (const [start, end] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
