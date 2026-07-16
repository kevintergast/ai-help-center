import { OPERATOR_TENANT_ID } from "@/lib/tenant/resolve";
import { getCurrentTenant } from "@/lib/tenant/current";
import { getEnvSafe } from "@/server/api/runtime-deps";
import { getDbSafe } from "@/server/db/client";
import { D1TenantRepository } from "@/server/tenant/repository";

/**
 * ZENTRALER SITEMAP-INDEX (nur Operator-Instanz, nur Produktion):
 * listet die sitemap.xml JEDER Instanz (app + alle Kunden-Subdomains).
 *
 * Zweck (SEO-Architektur): Frisch provisionierte Kunden-Hilfezentren haben
 * null eingehende Links — Google würde sie u. U. nie entdecken. Kevin
 * verifiziert hallofhelp.com einmalig als DOMAIN-Property in der Search
 * Console (deckt ALLE Subdomains ab) und reicht diesen Index EINMAL ein →
 * jede neue Kunden-Instanz wird automatisch entdeckt, ohne dass der Kunde
 * irgendetwas tut. Kunden mit eigener Domain (BYO) betreiben ihre Search
 * Console selbst — deren Subdomain bleibt hier trotzdem gelistet.
 *
 * Bewusst KEIN Tenant-Inhalt, nur Sitemap-URLs (die Subdomains sind ohnehin
 * öffentlich); Instanzen ohne veröffentlichte Artikel liefern schlicht eine
 * kurze Sitemap (nur Startseite) — harmlos.
 */
export async function GET(): Promise<Response> {
  const env = await getEnvSafe();
  if ((env?.APP_ENV ?? "development") !== "production") {
    return new Response(null, { status: 404 });
  }
  const tenant = await getCurrentTenant();
  if (!tenant || tenant.id !== OPERATOR_TENANT_ID) return new Response(null, { status: 404 });

  const db = await getDbSafe();
  if (!db) return new Response(null, { status: 503 });

  const baseDomain = env?.APP_BASE_DOMAIN ?? "hallofhelp.com";
  const slugs = await new D1TenantRepository(db).listSlugs();

  const items = slugs
    .map((slug) => `  <sitemap><loc>https://${slug}.${baseDomain}/sitemap.xml</loc></sitemap>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // Neue Tenants tauchen spätestens nach einer Stunde im Index auf.
      "cache-control": "public, max-age=3600",
    },
  });
}
