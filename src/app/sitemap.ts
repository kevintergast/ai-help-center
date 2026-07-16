import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getCurrentTenant } from "@/lib/tenant/current";
import { getEnvSafe } from "@/server/api/runtime-deps";
import { getHelpCenterRepo } from "@/server/content/runtime";

/**
 * PRO-TENANT sitemap.xml (SEO-Fundament, 2026-07-16): Startseite + alle
 * VERÖFFENTLICHTEN Artikel-URLs des per Host aufgelösten Tenants (der Repo-
 * Public-Read liefert ausschließlich published — Drafts können hier nie
 * leaken). Suchmaschinen finden die Sitemap über die robots.txt (robots.ts);
 * zusätzlich listet der zentrale Sitemap-Index der Operator-Instanz jede
 * Kunden-Sitemap (Cross-Submission, /sitemap-index.xml).
 *
 * NICHT-Produktion (Staging/lokal) liefert eine LEERE Sitemap — Gegenstück
 * zum Disallow-all in robots.ts (kein Staging-Content im Index).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const env = await getEnvSafe();
  if ((env?.APP_ENV ?? "development") !== "production") return [];

  const tenant = await getCurrentTenant();
  if (!tenant) return [];
  // Per-Instanz-SEO-Opt-out (Migration 0013): leere Sitemap.
  if (tenant.seoIndexable === false) return [];

  const h = await headers();
  const host = h.get("host") ?? `${tenant.slug}.hallofhelp.com`;
  const base = `https://${host}`;

  const repo = await getHelpCenterRepo(tenant);
  const articles = await repo.searchItems();

  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    ...articles.map((a) => ({
      url: `${base}/${a.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
