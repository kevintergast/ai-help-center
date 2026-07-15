import BetterSqlite3 from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { chunkParagraphs, MAX_CHUNK_CHARS } from "./chunking";
import { ArticleIndexer, type VectorStore } from "./indexer";

/**
 * ARTIKEL-INDEXER gegen die echte 0010-DDL (sqlite-Shim) mit Fake-Embeddings/
 * -Vectorize. Verhinderte Fehlerfälle:
 *  - Re-Publish ohne Änderung erzeugt erneute Embedding-Kosten (Hash-Vergleich tot).
 *  - Gekürzte Artikel lassen verwaiste Vektoren im Index (Geister-Treffer im RAG).
 *  - Unpublish/Delete entfernt Vektoren nicht (Draft-Leak über die Suche).
 *  - Vektoren ohne Tenant-Namespace/-Metadaten (Cross-Tenant-Retrieval-Risiko).
 */

function makeFakes() {
  const store = new Map<string, { values: number[]; namespace?: string; metadata?: Record<string, unknown> }>();
  const vectors: VectorStore = {
    upsert: async (vs) => {
      for (const v of vs) store.set(v.id, { values: v.values, namespace: v.namespace, metadata: v.metadata });
    },
    deleteByIds: async (ids) => {
      for (const id of ids) store.delete(id);
    },
  };
  let embedCalls = 0;
  let embeddedTexts: string[] = [];
  const embeddings = {
    embed: async (texts: string[]) => {
      embedCalls += 1;
      embeddedTexts = embeddedTexts.concat(texts);
      return texts.map((t) => [t.length, 1, 2]);
    },
  };
  return { store, vectors, embeddings, counters: { get embedCalls() { return embedCalls; }, get embeddedTexts() { return embeddedTexts; } } };
}

const ARTICLE = {
  id: "a1",
  slug: "erste-schritte",
  title: "Erste Schritte",
  body: ["Absatz eins.", "Absatz zwei."],
};

let sqlite: BetterSqlite3.Database;
let fakes: ReturnType<typeof makeFakes>;
let indexer: ArticleIndexer;

beforeEach(() => {
  sqlite = new BetterSqlite3(":memory:");
  applyMigrations(sqlite, ["0001_tenants.sql", "0010_search_chunks.sql"]);
  fakes = makeFakes();
  indexer = new ArticleIndexer({
    db: d1FromSqlite(sqlite),
    vectors: fakes.vectors,
    embeddings: fakes.embeddings,
  });
});

describe("chunkParagraphs (pur)", () => {
  it("kleine Absätze werden gemergt, Titel steht als Kontext davor", () => {
    const chunks = chunkParagraphs("Titel", ["a", "b"]);
    expect(chunks).toEqual(["Titel\n\na\n\nb"]);
  });

  it("lange Inhalte splitten an der Chunk-Grenze; Leer-Absätze fallen raus", () => {
    const long = "x".repeat(MAX_CHUNK_CHARS);
    const chunks = chunkParagraphs("T", [long, "  ", "kurz"]);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toBe("T\n\nkurz");
  });
});

describe("ArticleIndexer", () => {
  it("Erst-Index: Vektoren mit Tenant-Namespace/-Metadaten + D1-Buchführung", async () => {
    const result = await indexer.indexArticle("t_demo", ARTICLE);
    expect(result).toEqual({ chunks: 1, embedded: 1, deleted: 0 });

    const vec = fakes.store.get("t_demo:a1:0");
    expect(vec).toBeTruthy();
    expect(vec!.namespace).toBe("t_demo");
    expect(vec!.metadata).toMatchObject({ tenantId: "t_demo", articleId: "a1", slug: "erste-schritte" });

    const rows = sqlite.prepare(`SELECT * FROM search_chunks WHERE tenant_id = 't_demo'`).all();
    expect(rows).toHaveLength(1);
  });

  it("Re-Index ohne Änderung: KEIN erneutes Embedding (Kosten-Leitplanke)", async () => {
    await indexer.indexArticle("t_demo", ARTICLE);
    expect(fakes.counters.embedCalls).toBe(1);

    const again = await indexer.indexArticle("t_demo", ARTICLE);
    expect(again.embedded).toBe(0);
    expect(fakes.counters.embedCalls).toBe(1); // kein zweiter AI-Aufruf
  });

  it("Inhaltsänderung: nur der geänderte Chunk wird neu embedded", async () => {
    // Zwei Chunks erzwingen (jeder Absatz > halbe Chunk-Grenze).
    const big = {
      ...ARTICLE,
      body: ["A".repeat(MAX_CHUNK_CHARS - 100), "B".repeat(MAX_CHUNK_CHARS - 100)],
    };
    await indexer.indexArticle("t_demo", big);
    expect(fakes.counters.embeddedTexts).toHaveLength(2);

    const changed = { ...big, body: [big.body[0], "B".repeat(MAX_CHUNK_CHARS - 101) + "!"] };
    const result = await indexer.indexArticle("t_demo", changed);
    expect(result).toMatchObject({ chunks: 2, embedded: 1 });
    expect(fakes.counters.embeddedTexts).toHaveLength(3); // nur Chunk 2 erneut
  });

  it("gekürzter Artikel: verwaiste Vektoren + Buchführung werden entfernt", async () => {
    const big = {
      ...ARTICLE,
      body: ["A".repeat(MAX_CHUNK_CHARS - 100), "B".repeat(MAX_CHUNK_CHARS - 100)],
    };
    await indexer.indexArticle("t_demo", big);
    expect(fakes.store.size).toBe(2);

    const short = { ...ARTICLE, body: ["A".repeat(MAX_CHUNK_CHARS - 100)] };
    const result = await indexer.indexArticle("t_demo", short);
    expect(result.deleted).toBe(1);
    expect(fakes.store.size).toBe(1);
    expect(fakes.store.has("t_demo:a1:1")).toBe(false);

    const rows = sqlite.prepare(`SELECT chunk_index FROM search_chunks WHERE tenant_id='t_demo'`).all();
    expect(rows).toEqual([{ chunk_index: 0 }]);
  });

  it("removeArticle (unpublish/delete): Vektoren + Zeilen vollständig weg", async () => {
    await indexer.indexArticle("t_demo", ARTICLE);
    await indexer.removeArticle("t_demo", "a1");
    expect(fakes.store.size).toBe(0);
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM search_chunks`).get()).toEqual({ c: 0 });
  });

  it("Tenant-Isolation: gleiche Artikel-ID in zwei Tenants kollidiert nicht", async () => {
    await indexer.indexArticle("t_demo", ARTICLE);
    await indexer.indexArticle("t_acme", ARTICLE);
    expect(fakes.store.has("t_demo:a1:0")).toBe(true);
    expect(fakes.store.has("t_acme:a1:0")).toBe(true);

    await indexer.removeArticle("t_demo", "a1");
    expect(fakes.store.has("t_acme:a1:0")).toBe(true); // Nachbar unberührt
  });
});
