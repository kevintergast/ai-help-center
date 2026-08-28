import type { BrandingColors } from "./validate";

/**
 * Persistenz fürs pflegbare Branding (Farben in D1, Logo in R2).
 *
 * Die Interfaces sind bewusst minimal und strukturell — die echten Bindings
 * (D1Database, R2Bucket) erfüllen sie direkt, Tests speisen Map-basierte
 * Fakes ein (Repository-/Source-Pattern, keine echten Bindings in Tests).
 */

/** Bild-Slot einer Instanz: helles Logo (Standard, Spalte logo_r2_key),
 *  dunkles Logo (0023, logo_dark_r2_key) oder Favicon/Emblem (0031,
 *  favicon_r2_key). Dark und favicon sind optional — ohne dunkles Logo zeigt
 *  das UI im Dark Mode das helle, ohne Favicon dient das helle Logo als
 *  Tab-Icon (Kette in src/lib/theme/brand.ts). */
export type LogoVariant = "light" | "dark" | "favicon";

/** Query-/Body-Wert strikt auf eine Variante mappen (alles Unbekannte = light).
 *  Whitelist statt Blacklist: kein User-Input erzeugt je einen neuen Slot. */
export function parseLogoVariant(raw: string | undefined | null): LogoVariant {
  if (raw === "dark") return "dark";
  if (raw === "favicon") return "favicon";
  return "light";
}

/** Feste R2-Schlüssel pro Tenant+Variante: EIN Bild je Slot, Upload überschreibt.
 *  Kein User-Input im Key — die Tenant-ID kommt IMMER aus der Host-Auflösung. */
const KEY_SUFFIX: Record<LogoVariant, string> = {
  light: "logo",
  dark: "logo-dark",
  favicon: "favicon",
};

export function logoKeyFor(tenantId: string, variant: LogoVariant = "light"): string {
  return `tenants/${tenantId}/${KEY_SUFFIX[variant]}`;
}

/** Spalte je Variante — zentral, damit kein SQL-String die Wahl dupliziert. */
const LOGO_COLUMN: Record<LogoVariant, "logo_r2_key" | "logo_dark_r2_key" | "favicon_r2_key"> = {
  light: "logo_r2_key",
  dark: "logo_dark_r2_key",
  favicon: "favicon_r2_key",
};

/** Minimaler R2-Ausschnitt, den das Logo-Handling braucht (strukturkompatibel zu R2Bucket). */
export interface LogoBucket {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
  } | null>;
  delete(key: string): Promise<void>;
}

/** Schreib-/Lesezugriff auf die Branding-Spalten der `tenants`-Tabelle. */
export interface BrandingRepository {
  /** Farben aktualisieren + `branding_updated_at` setzen — NUR für diese Tenant-ID. */
  updateColors(tenantId: string, colors: BrandingColors): Promise<void>;
  /** Nach erfolgreichem R2-Upload: Key-Spalte der Variante + `branding_updated_at` setzen. */
  setLogoKey(tenantId: string, variant: LogoVariant, key: string): Promise<void>;
  /** Logo der Variante entfernen: Key-Spalte nullen, `branding_updated_at` setzen. */
  clearLogoKey(tenantId: string, variant: LogoVariant): Promise<void>;
  /** Aktueller R2-Schlüssel der Variante (null = kein hochgeladenes Logo). */
  getLogoKey(tenantId: string, variant: LogoVariant): Promise<string | null>;
}

/** Pro Request aufgelöste Branding-Infrastruktur (null = Bindings fehlen → 503). */
export interface BrandingDeps {
  repo: BrandingRepository;
  bucket: LogoBucket;
}

/** D1-Implementierung — jede Query ist über `WHERE id = ?` tenant-gebunden. */
export class D1BrandingRepository implements BrandingRepository {
  constructor(private readonly db: D1Database) {}

  async updateColors(tenantId: string, colors: BrandingColors): Promise<void> {
    await this.db
      .prepare(
        `UPDATE tenants
           SET color_primary = ?, color_accent = ?, color_primary_fg = ?,
               branding_updated_at = unixepoch()
         WHERE id = ?`,
      )
      .bind(colors.colorPrimary, colors.colorAccent, colors.colorPrimaryFg, tenantId)
      .run();
  }

  async setLogoKey(tenantId: string, variant: LogoVariant, key: string): Promise<void> {
    // Spaltenname aus dem festen Mapping (nie aus User-Input) — kein Injection-Vektor.
    await this.db
      .prepare(
        `UPDATE tenants SET ${LOGO_COLUMN[variant]} = ?, branding_updated_at = unixepoch() WHERE id = ?`,
      )
      .bind(key, tenantId)
      .run();
  }

  async clearLogoKey(tenantId: string, variant: LogoVariant): Promise<void> {
    await this.db
      .prepare(
        `UPDATE tenants SET ${LOGO_COLUMN[variant]} = NULL, branding_updated_at = unixepoch() WHERE id = ?`,
      )
      .bind(tenantId)
      .run();
  }

  async getLogoKey(tenantId: string, variant: LogoVariant): Promise<string | null> {
    const col = LOGO_COLUMN[variant];
    const row = await this.db
      .prepare(`SELECT ${col} AS key FROM tenants WHERE id = ?`)
      .bind(tenantId)
      .first<{ key: string | null }>();
    return row?.key ?? null;
  }
}
