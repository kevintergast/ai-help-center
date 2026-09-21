import type { ActionVariant } from "@/lib/content/action-buttons";
import type { ThemeConfig } from "@/lib/theme/palette";
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
  /** „Ich verstehe etwas nicht" (0039); fehlend = AN. */
  comprehensionMode?: boolean;
  /**
   * Eigene Farbwelt der Instanz (0045, Theme-Generator) — getrennte Sätze
   * für Hell und Dunkel. FEHLEND/null = keine eigene Farbwelt: es gilt das
   * Standard-Theme aus globals.css, überschrieben von den drei Marken-Farben
   * in `branding`. Ausgeliefert wird sie als <style>-Block (lib/theme/css.ts),
   * nicht als Inline-Style — ein Inline-Style kennt keine Modi.
   */
  theme?: ThemeConfig | null;
  /**
   * Fuß des Hilfezentrums (0046): welche der drei vorkonfigurierten
   * Rechtstexte dort stehen — plus der „Powered by"-Hinweis. FEHLEND =
   * alle drei Rechtstexte an, Hinweis aus (Registry-Fallback ohne
   * CF-Kontext und ältere Fixtures bleiben damit gültig).
   */
  footer?: {
    imprint: boolean;
    privacy: boolean;
    terms: boolean;
    poweredBy: boolean;
  };
  /** Erscheinungsbild des Widgets (0041). */
  widget?: {
    variant: ActionVariant;
    /** Eigene Beschriftung; null = i18n-Standard. */
    label: string | null;
    /** Eigene Symbole je Zustand; null = Standard-Zeichen. */
    iconUrl: string | null;
    iconOpenUrl: string | null;
  };
}
