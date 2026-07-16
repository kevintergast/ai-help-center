import type { Context } from "hono";
import type { ApiEnv } from "./context";

/**
 * IP-RATE-LIMITS (Abuse-Härtung, 2026-07-16) über Cloudflares Workers-
 * Rate-Limiting-Bindings (in-memory, pro Colo, kostenlos — wrangler.toml
 * `[[unsafe.bindings]] type="ratelimit"`).
 *
 * Einordnung (ehrlich): pro Colo ≈ „ungefähres" Limit, KEIN exakter globaler
 * Zähler — als Notbremse gegen Single-IP-Flutung gedacht. Die weiteren
 * Schichten: Turnstile (Signup/Reset/Tenant-Erstellung), signierte
 * Besucher-IDs (Dedup-/MAU-Integrität), KI-Tagesdeckel pro Besucher,
 * AI-Gateway-Spend-Limit (globaler Kill-Switch) und WAF-Regeln ([DU]).
 *
 * FAIL-OPEN by design: fehlt die Bindung (lokales dev/Tests) oder wirft sie,
 * läuft der Request durch — Rate-Limits sind Defense-in-Depth, nie die
 * einzige Kontrolle. Deployed sind die Bindungen immer vorhanden.
 */

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Bündel der konfigurierten Limiter (runtime-deps mappt env-Bindings). */
export interface RateLimiters {
  /** POST /ask — teuerster Pfad (LLM): eng (5/min/IP). */
  ask?: RateLimiterBinding;
  /** POST /events/* — Beacons (60/min/IP). */
  events?: RateLimiterBinding;
  /** Mail-Sender + Tenant-Erstellung (5/min/IP). */
  sensitive?: RateLimiterBinding;
}

/** Client-IP hinter Cloudflare (deployed immer gesetzt; dev: "local"). */
export function clientIp(c: Context<ApiEnv>): string {
  return c.req.header("cf-connecting-ip") ?? "local";
}

/**
 * true = darf passieren. Schlüssel IMMER mit Tenant präfixieren, wo es einen
 * gibt — ein Angreifer auf Tenant A darf das Limit von Tenant B nicht füllen.
 */
export async function allowRequest(
  limiter: RateLimiterBinding | undefined,
  key: string,
): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch (err) {
    console.error("[rate-limit] Binding-Fehler (fail-open):", err);
    return true;
  }
}

/** Einheitliche 429-Antwort (Client zeigt „kurz warten"). */
export function rateLimited(c: Context<ApiEnv>) {
  return c.json({ error: "rate_limited" }, 429);
}
