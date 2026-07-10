import type { Tenant } from "@/lib/tenant/types";
import { tenantSlugFromHost, resolveTenant as resolveFromRegistry } from "@/lib/tenant/resolve";
import { getDbSafe } from "@/server/db/client";
import { D1TenantRepository } from "./repository";

/** Minimaler Zugriff auf Mandanten — implementiert von D1-Repo und Test-Fakes. */
export interface TenantSource {
  getBySlug(slug: string): Promise<Tenant | null>;
  getByCustomDomain(domain: string): Promise<Tenant | null>;
}

/**
 * Fail-closed-Auflösung: Subdomain-Slug → getBySlug, sonst Custom-Domain →
 * getByCustomDomain; kein Treffer → null (KEIN Default-/Demo-Fallback).
 * Eine unbekannte/gespoofte Instanz darf nie auf einen fremden Tenant
 * kollabieren — weder in der API (404/421) noch beim Seiten-Rendering
 * (neutrale Not-Found-Shell). Eine fail-open-Variante gibt es bewusst NICHT.
 */
export async function resolveWithSourceStrict(
  source: TenantSource,
  host: string | null | undefined,
): Promise<Tenant | null> {
  const slug = tenantSlugFromHost(host);
  const hostname = (host ?? "").split(":")[0].toLowerCase();
  return slug ? source.getBySlug(slug) : source.getByCustomDomain(hostname);
}

/**
 * Mandanten-Auflösung für Server Components/Seiten:
 *  - D1 vorhanden (Worker / `next dev` mit Bindings): STRICT — unbekannter
 *    Host → null, der Aufrufer rendert eine neutrale Not-Found-Shell.
 *  - Kein D1 (Unit-Tests / reines `next dev` ohne Cloudflare-Kontext):
 *    Demo-Registry-Fallback. DEV-ONLY — im deployten Worker existiert dieser
 *    Zweig nicht, dort ist die DB-Bindung immer vorhanden.
 */
export async function resolveTenantSmart(host: string | null | undefined): Promise<Tenant | null> {
  const db = await getDbSafe();
  if (!db) return resolveFromRegistry(host);
  return resolveWithSourceStrict(new D1TenantRepository(db), host);
}
