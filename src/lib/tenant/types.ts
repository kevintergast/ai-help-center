export type Locale = "de" | "en";

/** Pro-Mandant anpassbares Erscheinungsbild (White-Label). */
export interface TenantBranding {
  /** Logo-URL (R2/Stream) oder null → Fallback-Initiale. */
  logoUrl: string | null;
  /** CSS-Farbe, z. B. "#4f46e5". */
  colorPrimary: string;
  /** CSS-Farbe für Akzente. */
  colorAccent: string;
  /** Textfarbe auf primary (Kontrast). */
  colorPrimaryFg: string;
}

/** Ein Mandant (Kunde) = ein Hilfezentrum. */
export interface Tenant {
  id: string;
  /** Subdomain-Slug: <slug>.hallofhelp.com */
  slug: string;
  name: string;
  /** Optionale eigene Domain (nur auf Paid-Plänen). */
  customDomain: string | null;
  defaultLocale: Locale;
  branding: TenantBranding;
  /**
   * Suchmaschinen-Indexierung (SEO-Opt-out, Migration 0013). `false` ⇒
   * noindex-Meta, robots Disallow-all, leere Sitemap, nicht im zentralen
   * Sitemap-Index. FEHLEND/`undefined` = indexierbar (Default, auch für
   * Dev-Registry-Tenants und ältere Test-Fixtures).
   */
  seoIndexable?: boolean;
  /**
   * Support-E-Mail der Instanz (Migration 0014): Ziel der Ticket-Mails aus
   * dem Support-Flow. FEHLEND/null = nicht konfiguriert (Tickets landen nur
   * in der Admin-Inbox).
   */
  supportEmail?: string | null;
}
