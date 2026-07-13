import type { BrandingColors } from "./validate";

/**
 * Persistenz fürs pflegbare Branding (Farben in D1, Logo in R2).
 *
 * Die Interfaces sind bewusst minimal und strukturell — die echten Bindings
 * (D1Database, R2Bucket) erfüllen sie direkt, Tests speisen Map-basierte
 * Fakes ein (Repository-/Source-Pattern, keine echten Bindings in Tests).
 */

/** Fester R2-Schlüssel pro Tenant: EIN Logo je Instanz, Upload überschreibt.
 *  Kein User-Input im Key — die Tenant-ID kommt IMMER aus der Host-Auflösung. */
export function logoKeyFor(tenantId: string): string {
  return `tenants/${tenantId}/logo`;
}

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
  /** Nach erfolgreichem R2-Upload: `logo_r2_key` + `branding_updated_at` setzen. */
  setLogoKey(tenantId: string, key: string): Promise<void>;
  /** Logo entfernen: `logo_r2_key` nullen, `branding_updated_at` setzen. */
  clearLogoKey(tenantId: string): Promise<void>;
  /** Aktueller R2-Schlüssel des Tenants (null = kein hochgeladenes Logo). */
  getLogoKey(tenantId: string): Promise<string | null>;
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

  async setLogoKey(tenantId: string, key: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE tenants SET logo_r2_key = ?, branding_updated_at = unixepoch() WHERE id = ?`,
      )
      .bind(key, tenantId)
      .run();
  }

  async clearLogoKey(tenantId: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE tenants SET logo_r2_key = NULL, branding_updated_at = unixepoch() WHERE id = ?`,
      )
      .bind(tenantId)
      .run();
  }

  async getLogoKey(tenantId: string): Promise<string | null> {
    const row = await this.db
      .prepare(`SELECT logo_r2_key FROM tenants WHERE id = ?`)
      .bind(tenantId)
      .first<{ logo_r2_key: string | null }>();
    return row?.logo_r2_key ?? null;
  }
}
