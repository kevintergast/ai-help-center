import { makeWorkersAiEmbeddings } from "@/server/ai/models";
import { changelogDoc, roadmapDoc } from "./aux-docs";
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

/**
 * Zeile aus `articles` → Indexer-Eingabe (body_json = JSON string[]).
 *
 * KANONISCHER Dokument-Builder: Indexierung, Antwort-Kontext (runtime-deps)
 * UND Staleness (answers/staleness.ts) MÜSSEN denselben Builder nutzen, damit
 * die content_hashes aller drei Seiten exakt übereinstimmen. Bild-
 * BESCHREIBUNGEN (Architektur: Pflicht, Alt-Text + KI-Kontext) werden als
 * eigene Absätze angehängt — ändert sich eine Beschreibung, ändern sich die
 * Hashes und gespeicherte Antworten werden korrekt „veraltet".
 */
export function toIndexable(row: {
  id: string;
  slug: string;
  title: string;
  body_json: string;
  images_json?: string;
  videos_json?: string;
}): IndexableArticle {
  let body: string[] = [];
  try {
    const parsed = JSON.parse(row.body_json) as unknown;
    if (Array.isArray(parsed)) body = parsed.filter((p): p is string => typeof p === "string");
  } catch {
    /* leerer Body → Artikel fällt aus dem Index */
  }
  if (row.images_json) {
    try {
      const images = JSON.parse(row.images_json) as unknown;
      if (Array.isArray(images)) {
        for (const img of images) {
          const i = img as { description?: unknown; pending?: unknown };
          // Vormerkungen (pending, Import ohne Binärdatei) beschreiben ein
          // Bild, das es noch NICHT gibt — sie gehören nicht in den KI-Index.
          if (i?.pending === true) continue;
          const desc = i?.description;
          if (typeof desc === "string" && desc.trim().length > 0) {
            body.push(`Bild: ${desc.trim()}`);
          }
        }
      }
    } catch {
      /* fehlerhafte Metadaten → Bild fällt aus dem Kontext */
    }
  }
  // Video-Beschreibungen sind wie Bild-Beschreibungen KI-Kontext (Architektur:
  // „RAG bindet nur mit Quell-Artikeln verknüpfte Videos ein").
  if (row.videos_json) {
    try {
      const videos = JSON.parse(row.videos_json) as unknown;
      if (Array.isArray(videos)) {
        for (const vid of videos) {
          const v = vid as { title?: unknown; description?: unknown };
          if (typeof v?.description === "string" && v.description.trim().length > 0) {
            const title = typeof v.title === "string" ? `${v.title.trim()}: ` : "";
            body.push(`Video: ${title}${v.description.trim()}`);
          }
        }
      }
    } catch {
      /* fehlerhafte Metadaten → Video fällt aus dem Kontext */
    }
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
    `SELECT id, slug, title, body_json, images_json, videos_json FROM articles
      WHERE tenant_id = ? AND id = ? AND status = 'published'`,
  )
    .bind(tenantId, articleId)
    .first<{ id: string; slug: string; title: string; body_json: string }>();

  const indexer = buildIndexer(env);
  if (row) await indexer.indexArticle(tenantId, toIndexable(row));
  else await indexer.removeArticle(tenantId, articleId);
}

/**
 * Backfill: alle veröffentlichten Artikel + Roadmap-Items + Changelog-Einträge
 * eines Tenants (nur Geändertes kostet Embeddings). Roadmap/Changelog haben
 * KEINE Lifecycle-Hooks (Pflege via Seeds) — der Reindex ist ihr Sync-Weg und
 * räumt deshalb auch verwaiste Aux-Chunks gelöschter Einträge ab.
 */
export async function rebuildTenantIndex(
  env: IndexerEnv,
  tenantId: string,
): Promise<{ articles: number; extras: number; chunks: number; embedded: number }> {
  const rows = await env.DB.prepare(
    `SELECT id, slug, title, body_json, images_json, videos_json FROM articles
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

  // Roadmap + Changelog als Pseudo-Dokumente (gemeinsame Builder → identische
  // Hashes wie beim Antwort-Kontext, s. aux-docs.ts).
  const [roadmap, changelog] = await Promise.all([
    env.DB.prepare(`SELECT id, title, status FROM roadmap_items WHERE tenant_id = ?`)
      .bind(tenantId)
      .all<{ id: string; title: string; status: string }>(),
    env.DB.prepare(`SELECT id, title, description FROM changelog_entries WHERE tenant_id = ?`)
      .bind(tenantId)
      .all<{ id: string; title: string; description: string }>(),
  ]);
  const auxDocs = [
    ...roadmap.results.map(roadmapDoc),
    ...changelog.results.map(changelogDoc),
  ];
  for (const doc of auxDocs) {
    const result = await indexer.indexArticle(tenantId, doc);
    chunks += result.chunks;
    embedded += result.embedded;
  }

  // Verwaiste Aux-Chunks (Eintrag gelöscht/umbenannt): indexierte Pseudo-Ids
  // gegen den aktuellen Bestand diffen und gezielt entfernen.
  const indexedAux = await env.DB.prepare(
    `SELECT DISTINCT article_id FROM search_chunks
      WHERE tenant_id = ? AND (article_id LIKE 'rm:%' OR article_id LIKE 'cl:%')`,
  )
    .bind(tenantId)
    .all<{ article_id: string }>();
  const liveAuxIds = new Set(auxDocs.map((d) => d.id));
  for (const row of indexedAux.results) {
    if (!liveAuxIds.has(row.article_id)) await indexer.removeArticle(tenantId, row.article_id);
  }

  return { articles: rows.results.length, extras: auxDocs.length, chunks, embedded };
}
