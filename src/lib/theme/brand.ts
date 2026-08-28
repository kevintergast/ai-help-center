import type { CSSProperties } from "react";
import type { TenantBranding } from "@/lib/tenant/types";

/**
 * Wandelt Tenant-Branding in CSS-Custom-Properties für das <html>-Tag um.
 * Damit greift das Theme (Tailwind-`brand`-Farben lesen diese Variablen) global.
 *
 * DARK-MODE-ENTSCHEIDUNG (v1, bewusst): globals.css definiert `--brand-*`
 * auch in den Dark-Blöcken (Demo-Defaults). Inline-Styles auf <html> haben
 * höhere Spezifität als jedes Stylesheet — das Tenant-Branding überstimmt
 * damit BEIDE Blöcke und gilt konstant in Light UND Dark. Ein Tenant pflegt
 * v1 also genau EINEN Farbsatz; optionale Dark-Varianten (z. B.
 * `colorPrimaryDark`) sind eine spätere, additive Erweiterung.
 */
export function brandingToStyle(b: TenantBranding): CSSProperties {
  return {
    "--brand-primary": b.colorPrimary,
    "--brand-accent": b.colorAccent,
    "--brand-primary-fg": b.colorPrimaryFg,
  } as CSSProperties;
}

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
