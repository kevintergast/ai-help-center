/// <reference types="@cloudflare/workers-types" />

// Startfassung — kann mit `pnpm cf-typegen` (wrangler types) aus wrangler.toml neu generiert werden.
interface CloudflareEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  VECTORIZE: VectorizeIndex;
  CACHE: KVNamespace;
  AI: Ai;
  ASSETS: Fetcher;
}
