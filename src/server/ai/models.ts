/**
 * ZENTRALE KI-KONFIGURATION (Infra-Plan Schritt 6) — die EINZIGE Stelle, an
 * der Modell-IDs und die AI-Gateway-ID stehen. Alle Workers-AI-Aufrufe laufen
 * durch das benannte Gateway `hallofhelp` (vom User im Dashboard angelegt,
 * inkl. Spend-Limit + Rate-Limit + Caching = Kosten-Leitplanken).
 */

export const AI_GATEWAY_ID = "hallofhelp";

/** Embeddings: bge-m3 → 1024 Dimensionen / Cosine — passend zu den Vectorize-Indizes. */
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";

/** Generierung (RAG, nächste Phase) — hier zentral, damit ein Wechsel ein Einzeiler ist. */
export const GENERATION_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Struktureller Embedding-Client (Tests injizieren deterministische Fakes). */
export interface EmbeddingClient {
  /** Liefert je Eingabetext einen Vektor (Reihenfolge bleibt erhalten). */
  embed(texts: string[]): Promise<number[][]>;
}

/** bge-m3-Antwortformen (Workers AI): { data: number[][] } — defensiv gelesen. */
interface EmbeddingResponse {
  data?: number[][];
}

export function makeWorkersAiEmbeddings(ai: Ai): EmbeddingClient {
  return {
    async embed(texts) {
      if (texts.length === 0) return [];
      const res = (await ai.run(
        EMBEDDING_MODEL as Parameters<Ai["run"]>[0],
        { text: texts },
        { gateway: { id: AI_GATEWAY_ID } },
      )) as EmbeddingResponse;
      const vectors = res?.data;
      if (!Array.isArray(vectors) || vectors.length !== texts.length) {
        throw new Error(
          `embeddings: unerwartete Antwortform (erwartet ${texts.length} Vektoren, erhalten ${vectors?.length ?? "keine"})`,
        );
      }
      return vectors;
    },
  };
}
