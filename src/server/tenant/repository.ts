import type { Locale, Tenant } from "@/lib/tenant/types";

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  custom_domain: string | null;
  default_locale: string;
  logo_url: string | null;
  logo_r2_key: string | null;
  branding_updated_at: number | null;
  color_primary: string;
  color_accent: string;
  color_primary_fg: string;
  seo_indexable: number;
}

const COLS =
  "id, slug, name, custom_domain, default_locale, logo_url, logo_r2_key, branding_updated_at, " +
  "color_primary, color_accent, color_primary_fg, seo_indexable";

/**
 * `branding.logoUrl` ist ABGELEITET (Priorität dokumentiert in 0003_branding.sql):
 *  1. `logo_r2_key` gesetzt → tenant-scoped Serving-Route; `?v=<branding_updated_at>`
 *     dient als Cache-Buster (die Route cached mit `immutable`).
 *  2. sonst `logo_url` (extern gehostetes Logo).
 *  3. sonst `null` → Fallback-Initiale im UI.
 */
export function deriveLogoUrl(r: Pick<TenantRow, "logo_url" | "logo_r2_key" | "branding_updated_at">): string | null {
  if (r.logo_r2_key) return `/api/v1/branding/logo?v=${r.branding_updated_at ?? 0}`;
  return r.logo_url;
}

/** Mappt eine D1-Zeile auf das Domänen-Objekt `Tenant`. */
export function rowToTenant(r: TenantRow): Tenant {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    customDomain: r.custom_domain,
    defaultLocale: (r.default_locale === "en" ? "en" : "de") as Locale,
    branding: {
      logoUrl: deriveLogoUrl(r),
      colorPrimary: r.color_primary,
      colorAccent: r.color_accent,
      colorPrimaryFg: r.color_primary_fg,
    },
    seoIndexable: r.seo_indexable !== 0,
  };
}

/** D1-gestützter Zugriff auf Mandanten. */
export class D1TenantRepository {
  constructor(private readonly db: D1Database) {}

  async getBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.db
      .prepare(`SELECT ${COLS} FROM tenants WHERE slug = ?`)
      .bind(slug)
      .first<TenantRow>();
    return row ? rowToTenant(row) : null;
  }

  /**
   * Slugs aller INDEXIERBAREN Tenants (zentraler Sitemap-Index auf der
   * Operator-Instanz — SEO-Cross-Submission für alle Kunden-Subdomains).
   * Instanzen mit SEO-Opt-out (seo_indexable=0) tauchen NICHT auf. Nur Slugs,
   * kein Tenant-Inhalt: die Subdomains sind ohnehin öffentlich erreichbar.
   */
  async listSlugs(): Promise<string[]> {
    const rows = await this.db
      .prepare(`SELECT slug FROM tenants WHERE seo_indexable = 1 ORDER BY slug`)
      .all<{ slug: string }>();
    return rows.results.map((r) => r.slug);
  }

  /** SEO-Opt-out setzen (Settings-API, owner-only — api/settings.ts). */
  async setSeoIndexable(tenantId: string, indexable: boolean): Promise<void> {
    await this.db
      .prepare(`UPDATE tenants SET seo_indexable = ? WHERE id = ?`)
      .bind(indexable ? 1 : 0, tenantId)
      .run();
  }

  async getByCustomDomain(domain: string): Promise<Tenant | null> {
    // A-7 (fail-closed): eine Custom-Domain löst NUR auf, wenn sie in
    // `tenant_domain` per TXT-Ownership-Proof VERIFIZIERT ist (Migration 0002:
    // "Ersetzt die Nutzung von tenants.custom_domain für die Auth-Auflösung").
    // Ohne dieses Gate würde jede eingetragene, nie bewiesene Domain
    // (Vertipper, Fremd-Claim) Requests auf den Tenant auflösen.
    const row = await this.db
      .prepare(
        `SELECT ${COLS} FROM tenants
          WHERE custom_domain = ?
            AND EXISTS (SELECT 1 FROM tenant_domain
                         WHERE tenant_domain.tenant_id = tenants.id
                           AND tenant_domain.domain = tenants.custom_domain
                           AND tenant_domain.status = 'verified')`,
      )
      .bind(domain)
      .first<TenantRow>();
    return row ? rowToTenant(row) : null;
  }
}
