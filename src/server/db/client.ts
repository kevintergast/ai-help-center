/**
 * Liefert die D1-Bindung zur Laufzeit (Worker / `next dev` via OpenNext).
 * Gibt `null` zurück, wenn kein Cloudflare-Kontext existiert (z. B. Unit-Tests) —
 * die Aufrufer fallen dann auf die Demo-Registry zurück.
 *
 * Dynamischer Import + try/catch, damit ein fehlender Kontext niemals einen Fehler wirft.
 */
export async function getDbSafe(): Promise<D1Database | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = getCloudflareContext() as { env?: CloudflareEnv };
    return ctx.env?.DB ?? null;
  } catch {
    return null;
  }
}
