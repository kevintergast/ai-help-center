export type Locale = "de" | "en";

/** Pro-Mandant anpassbares Erscheinungsbild (White-Label). */
export interface TenantBranding {
  /** Logo-URL (R2/Stream) oder null → Fallback-Initiale. */
  logoUrl: string | null;
  /**
   * Dark-Mode-Logo (Migration 0023). FEHLEND/null = kein eigenes dunkles
   * Logo → Dark Mode zeigt das helle (optional wie seoIndexable, damit
   * Dev-Registry/ältere Fixtures ohne das Feld gültig bleiben).
   */
  logoDarkUrl?: string | null;
  /**
   * EIGENES Favicon/Emblem der Instanz (Migration 0031). FEHLEND/null = kein
   * eigenes Tab-Icon → `faviconUrlFor` (lib/theme/brand.ts) nimmt das helle
   * Logo und, wenn auch das fehlt, das Plattform-Icon.
   */
  faviconUrl?: string | null;
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
  /**
   * Instanzname im Header anzeigen (Migration 0025). FEHLEND/true = anzeigen.
   * Nur relevant, wenn ein Logo gesetzt ist — ohne Logo zeigt die UI den
   * Namen IMMER (sonst leerer Header).
   */
  showHeaderName?: boolean;
  /**
   * Widget-Launcher auf den eigenen öffentlichen Seiten anzeigen (0028).
   * `undefined` = wie `false` behandeln (Registry-Fallback ohne CF-Kontext).
   */
  widgetOnSite?: boolean;
}
