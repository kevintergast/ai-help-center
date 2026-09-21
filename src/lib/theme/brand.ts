import type { TenantBranding } from "@/lib/tenant/types";

/*
 * Die Farbwelt einer Instanz liegt NICHT mehr als Inline-Style auf <html>.
 * Ein Inline-Style kennt keine Bedingung: er überstimmt Hell- und Dunkel-Block
 * gleichermaßen, weshalb eine Instanz bis 0045 genau EINEN Farbsatz für beide
 * Modi haben konnte. Seit dem Theme-Generator liefert `tenantThemeCss`
 * (lib/theme/css.ts) einen <style>-Block mit getrennten Modi aus; die
 * Kaskade-Entscheidung ist dort dokumentiert.
 */

/**
 * Plattform-Icon als letzter Rückfall (public/brand/icon.svg — dieselbe
 * Bildmarke wie `BrandMark`). Liegt BEWUSST unter public/ statt als
 * `src/app/icon.svg`: die Datei-Konvention von Next erzeugt ein festes
 * <link rel="icon"> und überstimmt `metadata.icons` — damit wäre ein
 * Tenant-Favicon nicht möglich.
 */
export const PLATFORM_FAVICON_URL = "/brand/icon.svg";

/**
 * Tab-Icon der Instanz (0031) — Priorität:
 *  1. eigenes Favicon/Emblem (Upload im Verwaltungsbereich),
 *  2. sonst AUTOMATISCH das helle Logo (der Normalfall: wer ein Logo
 *     hochlädt, will es auch im Tab sehen — Favicon-Pflege ist optional),
 *  3. sonst das Plattform-Icon.
 * Beide Tenant-URLs tragen bereits den ?v=-Cache-Buster aus
 * `branding_updated_at`, ein Wechsel schlägt also sofort durch.
 */
export function faviconUrlFor(b: TenantBranding): string {
  return b.faviconUrl ?? b.logoUrl ?? PLATFORM_FAVICON_URL;
}
