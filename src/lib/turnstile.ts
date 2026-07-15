import { cache } from "react";

/**
 * Turnstile-Site-Key für Server-Komponenten (öffentlicher Wert, wandert als
 * Prop in die Client-Formulare). `null` = nicht konfiguriert (lokales `next dev`
 * ohne Bindings) → die Formulare rendern KEIN Widget und der Server prüft in
 * dieser Umgebung auch nicht (Matrix: src/server/security/turnstile.ts).
 * Muster identisch zu getAppEnv/getDbSafe: dynamic import + try/catch, wirft nie.
 */
export const getTurnstileSiteKey = cache(async (): Promise<string | null> => {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = getCloudflareContext() as { env?: CloudflareEnv };
    const key = ctx.env?.TURNSTILE_SITE_KEY;
    return typeof key === "string" && key.length > 0 ? key : null;
  } catch {
    return null;
  }
});
