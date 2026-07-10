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
