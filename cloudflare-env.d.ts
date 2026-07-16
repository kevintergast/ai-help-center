/// <reference types="@cloudflare/workers-types" />

// Startfassung — kann mit `pnpm cf-typegen` (wrangler types) aus wrangler.toml neu generiert werden.
interface CloudflareEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  VECTORIZE: VectorizeIndex;
  CACHE: KVNamespace;
  AI: Ai;
  ASSETS: Fetcher;
  // Laufzeitumgebung für den Anzeige-Marker: "development" (Staging) | "production".
  APP_ENV?: string;
  // AUTH_SECRET: lokal String (.dev.vars), in Staging/Prod Secrets-Store-Binding (async .get()).
  AUTH_SECRET: string | { get(): Promise<string> };
  // Resend API-Key für E-Mail-Versand (Verifikation/Passwort-Reset). Optional:
  // fehlt er, ist der Versand ein No-op (siehe src/server/auth/resend.ts).
  RESEND_API_KEY?: string;
  // Social Login (Phase E). Fehlt ein Client-ID/Secret-Paar, wird der jeweilige
  // Provider NICHT registriert (kein Crash) — siehe src/server/auth/social.ts.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  // Turnstile (Bot-Schutz Signup/Reset-Anforderung/Tenant-Erstellung).
  // Site-Key ist öffentlich (var); Secret lokal String, deployed Secrets-Store.
  // Fehlt das Secret: dev → Schutz aus (inert), Prod → fail-closed
  // (Matrix: src/server/security/turnstile.ts).
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string | { get(): Promise<string> };
  // IP-Rate-Limits (Workers Rate Limiting API, wrangler [[unsafe.bindings]]).
  // Fehlen sie (dev/Tests), laufen Requests ungebremst (fail-open, s.
  // api/rate-limit.ts). Struktur-Typ dort (RateLimiterBinding).
  RL_ASK?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  RL_EVENTS?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  RL_SENSITIVE?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  // Embedding-Queue (Infra-Plan Schritt 6, Workers Paid): Producer-Binding.
  // Fehlt sie (lokales next dev vor Binding-Neustart), läuft der Index-Sync
  // direkt (waitUntil) — Weiche in runtime-deps.ts.
  EMBED_QUEUE?: Queue<{ tenantId: string; articleId: string }>;
  // Cloudflare for SaaS (Custom-Domain-Provisioning, Infra-Plan Schritt 5).
  // Fehlen beide/eins: Verify funktioniert, Provisioning wird "skipped"
  // (inert — siehe src/server/domains/provisioner.ts). Token scoped:
  // Zone → SSL and Certificates: Edit (nur unsere Zone).
  CF_SAAS_API_TOKEN?: string | { get(): Promise<string> };
  CF_ZONE_ID?: string;
}
