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
}

/** Absätze → Chunk-Texte (ohne Hash; pur, synchron, leicht testbar). */
export function chunkParagraphs(title: string, paragraphs: string[]): string[] {
  const clean = paragraphs.map((p) => p.trim()).filter((p) => p.length > 0);
  if (clean.length === 0) return [];

  const groups: string[] = [];
  let current = "";
  for (const p of clean) {
    const candidate = current.length === 0 ? p : `${current}\n\n${p}`;
    if (candidate.length > MAX_CHUNK_CHARS && current.length > 0) {
      groups.push(current);
      current = p;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) groups.push(current);

  const prefix = title.trim();
  return groups.map((g) => (prefix.length > 0 ? `${prefix}\n\n${g}` : g));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildChunks(article: {
  title: string;
  body: string[];
}): Promise<ArticleChunk[]> {
  const texts = chunkParagraphs(article.title, article.body);
  return Promise.all(
    texts.map(async (text, index) => ({ index, text, hash: await sha256Hex(text) })),
  );
}
