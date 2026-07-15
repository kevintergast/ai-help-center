import type { EmbeddingClient } from "@/server/ai/models";
import { buildChunks } from "./chunking";

/**
 * ARTIKEL-INDEXER (Infra-Plan Schritt 6): hält Vectorize synchron zum
 * Content-Lifecycle. NUR veröffentlichte Artikel sind im Index (dieselbe harte
 * Regel wie der Public-Read); Buchführung in `search_chunks` (0010).
 *
 * KOSTEN-LEITPLANKE: beim Re-Index werden ausschließlich Chunks mit
 * GEÄNDERTEM content_hash neu embedded (ein AI-Aufruf für alle geänderten
 * Chunks zusammen). Unveränderte Artikel kosten beim Re-Publish 0 Neuronen.
 *
 * ISOLATION: Vektor-IDs sind `${tenantId}:${articleId}:${chunkIndex}`, jeder
 * Vektor trägt den Tenant als Vectorize-NAMESPACE (harte Query-Grenze) UND in
 * den Metadaten (Belt-and-Suspenders fürs spätere Retrieval-Filter).
 *
 * AUSFÜHRUNG: heute direkt (per waitUntil aus der Route, s. runtime-deps) —
 * die Queue-Variante (Workers Paid) ersetzt später NUR den Aufrufweg, nicht
 * diese Logik.
 */

/** Struktureller Vectorize-Ausschnitt (VectorizeIndex erfüllt ihn direkt). */
export interface VectorStore {
  upsert(
    vectors: {
      id: string;
      values: number[];
      namespace?: string;
      metadata?: Record<string, string | number | boolean>;
    }[],
  ): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

export interface IndexerDeps {
  db: D1Database;
  vectors: VectorStore;
  embeddings: EmbeddingClient;
}

export interface IndexableArticle {
  id: string;
  slug: string;
  title: string;
  body: string[];
}

export interface IndexResult {
  chunks: number;
  /** Tatsächlich neu embeddete Chunks (Hash geändert/neu). */
  embedded: number;
  deleted: number;
}

const vectorId = (tenantId: string, articleId: string, index: number) =>
  `${tenantId}:${articleId}:${index}`;

interface ChunkRow {
  chunk_index: number;
  content_hash: string;
  vector_id: string;
}

export class ArticleIndexer {
  constructor(private readonly deps: IndexerDeps) {}

  async indexArticle(tenantId: string, article: IndexableArticle): Promise<IndexResult> {
    const { db, vectors, embeddings } = this.deps;
    const chunks = await buildChunks(article);
    const nowSec = Math.floor(Date.now() / 1000);

    const existing = await db
      .prepare(
        `SELECT chunk_index, content_hash, vector_id FROM search_chunks
          WHERE tenant_id = ? AND article_id = ?`,
      )
      .bind(tenantId, article.id)
      .all<ChunkRow>();
    const byIndex = new Map(existing.results.map((r) => [r.chunk_index, r]));

    // Nur geänderte/neue Chunks embedden (EIN Batch-Aufruf).
    const changed = chunks.filter((c) => byIndex.get(c.index)?.content_hash !== c.hash);
    if (changed.length > 0) {
      const embedded = await embeddings.embed(changed.map((c) => c.text));
      await vectors.upsert(
        changed.map((c, i) => ({
          id: vectorId(tenantId, article.id, c.index),
          values: embedded[i],
          namespace: tenantId,
          metadata: {
            tenantId,
            articleId: article.id,
            chunkIndex: c.index,
            contentHash: c.hash,
            slug: article.slug,
            title: article.title,
          },
        })),
      );
    }

    // Verwaiste Vektoren (Artikel wurde kürzer) gezielt löschen.
    const stale = existing.results.filter((r) => r.chunk_index >= chunks.length);
    if (stale.length > 0) await vectors.deleteByIds(stale.map((r) => r.vector_id));

    // Buchführung in EINER Transaktion nachziehen.
    const statements = [
      db
        .prepare(`DELETE FROM search_chunks WHERE tenant_id = ? AND article_id = ? AND chunk_index >= ?`)
        .bind(tenantId, article.id, chunks.length),
      ...changed.map((c) =>
        db
          .prepare(
            `INSERT INTO search_chunks (tenant_id, article_id, chunk_index, content_hash, vector_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (tenant_id, article_id, chunk_index)
             DO UPDATE SET content_hash = excluded.content_hash,
                           vector_id    = excluded.vector_id,
                           updated_at   = excluded.updated_at`,
          )
          .bind(tenantId, article.id, c.index, c.hash, vectorId(tenantId, article.id, c.index), nowSec),
      ),
    ];
    await db.batch(statements);

    return { chunks: chunks.length, embedded: changed.length, deleted: stale.length };
  }

  async removeArticle(tenantId: string, articleId: string): Promise<void> {
    const { db, vectors } = this.deps;
    const rows = await db
      .prepare(`SELECT vector_id FROM search_chunks WHERE tenant_id = ? AND article_id = ?`)
      .bind(tenantId, articleId)
      .all<{ vector_id: string }>();
    if (rows.results.length > 0) {
      await vectors.deleteByIds(rows.results.map((r) => r.vector_id));
      await db
        .prepare(`DELETE FROM search_chunks WHERE tenant_id = ? AND article_id = ?`)
        .bind(tenantId, articleId)
        .run();
    }
  }
}
