import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { OPERATOR_TENANT_ID } from "@/lib/tenant/resolve";
import { getCurrentTenant } from "@/lib/tenant/current";
import { getEnvSafe } from "@/server/api/runtime-deps";

/**
 * PRO-TENANT robots.txt (SEO-Fundament, 2026-07-16): öffentliche Hilfe-Inhalte
 * sind explizit crawlbar (Ranking ist gewollt — Architektur: SEO-Artikel-URLs);
 * Auth-/Admin-/API-Flächen sind für Crawler wertlos bis schädlich (Duplicate
 * Thin Content, Login-Wände) → disallow. Läuft PRO REQUEST (Host → Tenant),
 * die Sitemap-URL zeigt auf denselben Host, über den der Crawler gekommen ist.
 *
 * KOMPLETT GESPERRT wird bei: unbekanntem Host (Not-Found-Shell) und
 * NICHT-Produktion (APP_ENV) — Staging (*.dev.hallofhelp.com) und lokale
 * Umgebungen dürfen NIE im Index landen (Duplicate Content gegen Prod).
 *
 * Die Operator-Instanz deklariert zusätzlich den zentralen SITEMAP-INDEX
 * (alle Kunden-Sitemaps, /sitemap-index.xml) — Cross-Submission, damit Google
 * frisch provisionierte Kunden-Subdomains ohne Kunden-Zutun entdeckt.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const blockAll: MetadataRoute.Robots = { rules: [{ userAgent: "*", disallow: "/" }] };

  const env = await getEnvSafe();
  if ((env?.APP_ENV ?? "development") !== "production") return blockAll;

  const tenant = await getCurrentTenant();
  if (!tenant) return blockAll;
  // Per-Instanz-SEO-Opt-out (Migration 0013): Kunde will nicht gefunden werden.
  if (tenant.seoIndexable === false) return blockAll;

  const h = await headers();
  const host = h.get("host") ?? `${tenant.slug}.hallofhelp.com`;
  const base = `https://${host}`;

  const sitemaps = [`${base}/sitemap.xml`];
  if (tenant.id === OPERATOR_TENANT_ID) sitemaps.push(`${base}/sitemap-index.xml`);

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/console",
          "/login",
          "/signup",
          "/verify-email",
          "/forgot-password",
          "/reset-password",
          "/mfa/",
          "/invite/",
          "/api/",
          "/brandbook",
          "/widget",
        ],
      },
    ],
    sitemap: sitemaps,
  };
}
