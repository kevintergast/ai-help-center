type SecretLike = string | { get(): Promise<string> };

/**
 * Liest AUTH_SECRET einheitlich:
 * - lokal (.dev.vars): plain String
 * - Staging/Prod (Cloudflare Secrets Store): Binding-Objekt mit async `.get()`
 */
export async function getAuthSecret(env: { AUTH_SECRET?: SecretLike }): Promise<string> {
  const s = env.AUTH_SECRET;
  if (typeof s === "string" && s.length > 0) return s;
  if (s && typeof s === "object" && typeof s.get === "function") {
    const v = await s.get();
    if (v) return v;
  }
  throw new Error("AUTH_SECRET fehlt oder hat unerwartetes Format");
}
