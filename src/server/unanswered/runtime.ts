import type { Tenant } from "@/lib/tenant/types";
import { getDbSafe } from "@/server/db/client";
import { D1UnansweredRepository, type UnansweredGroup } from "./store";

/**
 * SERVER-Accessor der Redaktions-Warteschlange (0047) für den
 * Verwaltungsbereich. Ohne D1 (reines `next dev`) eine leere Liste — kein
 * Fehler: Die Statistik-Seite soll lokal weiter rendern, nur eben ohne Daten.
 */
export async function listUnanswered(tenant: Tenant, limit = 20): Promise<UnansweredGroup[]> {
  const db = await getDbSafe();
  if (!db) return [];
  return new D1UnansweredRepository(db).list(tenant.id, limit);
}
