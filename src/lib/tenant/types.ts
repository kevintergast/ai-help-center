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
  /** Subdomain-Slug: <slug>.hallofhelp.app */
  slug: string;
  name: string;
  /** Optionale eigene Domain (nur auf Paid-Plänen). */
  customDomain: string | null;
  defaultLocale: Locale;
  branding: TenantBranding;
}
