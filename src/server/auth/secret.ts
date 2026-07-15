export type SecretLike = string | { get(): Promise<string> };

/**
 * Liest einen Secret-Wert einheitlich (Cloudflare-Duck-Typing):
 * - lokal (.dev.vars): plain String
 * - Staging/Prod (Cloudflare Secrets Store): Binding-Objekt mit async `.get()`
 * `null` = nicht konfiguriert/leer — der Aufrufer entscheidet fail-closed vs. inert.
 */
export async function readSecretValue(s: SecretLike | undefined): Promise<string | null> {
  if (typeof s === "string") return s.length > 0 ? s : null;
  if (s && typeof s === "object" && typeof s.get === "function") {
    try {
      const v = await s.get();
      if (v) return v;
    } catch {
      // Secrets-Store-Binding ohne hinterlegten Wert (z. B. lokaler Dev-Store)
      // wirft — für den Aufrufer ist das schlicht „nicht konfiguriert" (null);
      // Pflicht-Secrets machen daraus ihren eigenen harten Fehler (getAuthSecret).
    }
  }
  return null;
}

/** AUTH_SECRET ist Pflicht — fehlend/leer ist ein harter Konfigurationsfehler. */
export async function getAuthSecret(env: { AUTH_SECRET?: SecretLike }): Promise<string> {
  const v = await readSecretValue(env.AUTH_SECRET);
  if (v) return v;
  throw new Error("AUTH_SECRET fehlt oder hat unerwartetes Format");
}
