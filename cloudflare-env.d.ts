/// <reference types="@cloudflare/workers-types" />

// Startfassung — kann mit `pnpm cf-typegen` (wrangler types) aus wrangler.toml neu generiert werden.
interface CloudflareEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  VECTORIZE: VectorizeIndex;
  CACHE: KVNamespace;
  AI: Ai;
  ASSETS: Fetcher;
  // AUTH_SECRET: lokal String (.dev.vars), in Staging/Prod Secrets-Store-Binding (async .get()).
  AUTH_SECRET: string | { get(): Promise<string> };
  // Resend API-Key für E-Mail-Versand (Verifikation/Passwort-Reset). Optional:
  // fehlt er, ist der Versand ein No-op (siehe src/server/auth/resend.ts).
  RESEND_API_KEY?: string;
}
