/**
 * GROUNDING-ENTSCHEIDUNG (RAG-Kern, Architektur-Trust-Schicht): Die KI
 * antwortet NUR, wenn das Retrieval belastbare Treffer liefert — sonst ehrliche
 * No-Answer (nie halluzinieren, Pflicht-Testziel lt. CLAUDE.md). Reine
 * Funktionen, vollständig getestet.
 */

/**
 * Ein Vectorize-Treffer nach Metadaten-Mapping (Text kommt später aus D1).
 * `docId` = Artikel-Id ODER Pseudo-Id (`rm:`/`cl:`, Roadmap/Changelog).
 */
export interface RetrievalMatch {
  docId: string;
  chunkIndex: number;
  /** Cosine-Ähnlichkeit (bge-m3, 0..1). */
  score: number;
}

/**
 * Mindest-Ähnlichkeit für „geerdet". bge-m3-Cosine: thematisch passende
 * Frage↔Absatz-Paare liegen erfahrungsgemäß ≥ ~0.55; darunter beginnt
 * Themen-Rauschen. Bewusst konservativ (lieber No-Answer als Halluzination);
 * wird nach echten Nutzungsdaten kalibriert.
 */
export const GROUNDING_MIN_SCORE = 0.55;

/** Obergrenze der Kontext-Chunks (Prompt-Budget; ~6 × ≤1200 Zeichen). */
export const MAX_CONTEXT_CHUNKS = 6;

export interface GroundingResult {
  grounded: boolean;
  /** Beste Treffer über der Schwelle, dedupliziert, absteigend nach Score. */
  selected: RetrievalMatch[];
}

/**
 * Schwellen-Entscheidung + Kontextauswahl:
 *  - dedupliziert (articleId, chunkIndex) — Vectorize kann bei Upsert-Rennen
 *    theoretisch Duplikate liefern,
 *  - nur Treffer ≥ minScore, absteigend sortiert, gekappt auf maxChunks,
 *  - geerdet ⇔ mindestens EIN Treffer über der Schwelle.
 */
export function assessGrounding(
  matches: RetrievalMatch[],
  opts: { minScore?: number; maxChunks?: number } = {},
): GroundingResult {
  const minScore = opts.minScore ?? GROUNDING_MIN_SCORE;
  const maxChunks = opts.maxChunks ?? MAX_CONTEXT_CHUNKS;

  const seen = new Set<string>();
  const selected = matches
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .filter((m) => {
      const key = `${m.docId}:${m.chunkIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxChunks);

  return { grounded: selected.length > 0, selected };
}
