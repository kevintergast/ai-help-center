export type AppEnv = "local" | "development" | "production";

/**
 * Aktuelle Laufzeitumgebung:
 *  - `local`        → lokaler `next dev` (NODE_ENV=development)
 *  - `development`  → deployte Staging-/Dev-Instanz (APP_ENV≠"production")
 *  - `production`   → Prod-Worker (APP_ENV="production")
 *
 * Dient nur der Anzeige (Env-Marker). Fail-safe: bei Unsicherheit NICHT
 * "production" (der Marker soll eher fälschlich erscheinen als auf Prod fehlen).
 */
export async function getAppEnv(): Promise<AppEnv> {
  if (process.env.NODE_ENV !== "production") return "local";
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = getCloudflareContext() as { env?: CloudflareEnv };
    return ctx.env?.APP_ENV === "production" ? "production" : "development";
  } catch {
    return "development";
  }
}
