/**
 * Artikel-Chunking fürs Embedding (Infra-Plan Schritt 6) — pur & deterministisch.
 *
 * Strategie (MVP, bewusst simpel): Absätze werden gierig zu Chunks von bis zu
 * MAX_CHUNK_CHARS zusammengefasst; jeder Chunk trägt den Artikeltitel als
 * Kontext-Präfix (verbessert Retrieval bei kurzen Absätzen). Der content_hash
 * (sha256 über den finalen Chunk-Text) ist zugleich die Staleness-Basis der
 * Architektur: ändert sich der Hash, sind darauf gebaute generierte Artikel
 * veraltet.
 */

export const MAX_CHUNK_CHARS = 1200;

export interface ArticleChunk {
  index: number;
  text: string;
  /** sha256(text) als Hex — Re-Embed-Vergleich + Staleness-Anker. */
  hash: string;
  /**
   * Welche Absätze (Index in `paragraphs`) dieser Chunk abdeckt — beide
   * Grenzen einschließlich.
   *
   * Dient der Zuordnung von ZIELEN zum gefundenen Abschnitt: Die Gruppierung
   * richtet sich nach Zeichenzahl, nicht nach Überschriften, also lässt sich
   * „welches Ziel gehört hierher?" nur über diese Spanne beantworten. Der
   * Hash bleibt bewusst allein über `text` — Staleness darf sich durch diese
   * Zusatzangabe NICHT ändern.
   */
  from: number;
  to: number;
}

interface Group {
  text: string;
  from: number;
  to: number;
}

/**
 * Absätze gierig gruppieren und dabei die URSPRÜNGLICHEN Indizes mitführen.
 * Leere Absätze fallen raus, verschieben die Nummerierung aber nicht — sonst
 * zeigten Ziel-Zuordnungen hinterher auf den falschen Abschnitt.
 */
function groupParagraphs(paragraphs: string[]): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  paragraphs.forEach((raw, i) => {
    const p = raw.trim();
    if (p.length === 0) return;
    if (current === null) {
      current = { text: p, from: i, to: i };
      return;
    }
    const candidate = `${current.text}\n\n${p}`;
    if (candidate.length > MAX_CHUNK_CHARS) {
      groups.push(current);
      current = { text: p, from: i, to: i };
    } else {
      current.text = candidate;
      current.to = i;
    }
  });
  if (current !== null) groups.push(current);
  return groups;
}

/** Absätze → Chunk-Texte (ohne Hash; pur, synchron, leicht testbar). */
export function chunkParagraphs(title: string, paragraphs: string[]): string[] {
  return chunkGroups(title, paragraphs).map((g) => g.text);
}

/** Wie `chunkParagraphs`, zusätzlich mit der abgedeckten Absatz-Spanne. */
export function chunkGroups(title: string, paragraphs: string[]): Group[] {
  const prefix = title.trim();
  return groupParagraphs(paragraphs).map((g) => ({
    ...g,
    text: prefix.length > 0 ? `${prefix}\n\n${g.text}` : g.text,
  }));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildChunks(article: {
  title: string;
  body: string[];
}): Promise<ArticleChunk[]> {
  const groups = chunkGroups(article.title, article.body);
  return Promise.all(
    groups.map(async (g, index) => ({
      index,
      text: g.text,
      hash: await sha256Hex(g.text),
      from: g.from,
      to: g.to,
    })),
  );
}
