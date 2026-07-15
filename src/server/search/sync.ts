import { makeWorkersAiEmbeddings } from "@/server/ai/models";
import { ArticleIndexer, type IndexableArticle } from "./indexer";

/**
 * GEMEINSAME Index-Sync-Logik (Infra-Plan Schritt 6) — env-parametrisiert,
 * damit BEIDE Aufrufwege identisch arbeiten:
 *  - Request-Pfad (runtime-deps → waitUntil bzw. Queue-Producer),
 *  - Queue-Consumer (Worker-Entry, OHNE OpenNext-Request-Kontext).
 */

export type IndexerEnv = Pick<CloudflareEnv, "DB" | "VECTORIZE" | "AI">;

export function buildIndexer(env: IndexerEnv): ArticleIndexer {
  return new ArticleIndexer({
    db: env.DB,
    vectors: env.VECTORIZE,
    embeddings: makeWorkersAiEmbeddings(env.AI),
  });
}

/** Zeile aus `articles` → Indexer-Eingabe (body_json = JSON string[]). */
export function toIndexable(row: {
  id: string;
  slug: string;
  title: string;
  body_json: string;
}): IndexableArticle {
  let body: string[] = [];
  try {
    const parsed = JSON.parse(row.body_json) as unknown;
    if (Array.isArray(parsed)) body = parsed.filter((p): p is string => typeof p === "string");
  } catch {
    /* leerer Body → Artikel fällt aus dem Index */
  }
  return { id: row.id, slug: row.slug, title: row.title, body };
}

/**
 * Kern-Sync: aktuellen Status lesen → published = (re)indexieren, sonst aus
 * dem Index entfernen. Idempotent — beliebig oft wiederholbar (Queue-Retry).
 */
export async function syncArticleIndex(
  env: IndexerEnv,
  tenantId: string,
  articleId: string,
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT id, slug, title, body_json FROM articles
      WHERE tenant_id = ? AND id = ? AND status = 'published'`,
  )
    .bind(tenantId, articleId)
    .first<{ id: string; slug: string; title: string; body_json: string }>();

  const indexer = buildIndexer(env);
  if (row) await indexer.indexArticle(tenantId, toIndexable(row));
  else await indexer.removeArticle(tenantId, articleId);
}

/** Backfill: alle veröffentlichten Artikel eines Tenants (nur Geändertes kostet). */
export async function rebuildTenantIndex(
  env: IndexerEnv,
  tenantId: string,
): Promise<{ articles: number; chunks: number; embedded: number }> {
  const rows = await env.DB.prepare(
    `SELECT id, slug, title, body_json FROM articles
      WHERE tenant_id = ? AND status = 'published'`,
  )
    .bind(tenantId)
    .all<{ id: string; slug: string; title: string; body_json: string }>();

  const indexer = buildIndexer(env);
  let chunks = 0;
  let embedded = 0;
  for (const row of rows.results) {
    const result = await indexer.indexArticle(tenantId, toIndexable(row));
    chunks += result.chunks;
    embedded += result.embedded;
  }
  return { articles: rows.results.length, chunks, embedded };
}
