import type { CSSProperties } from "react";
import type { TenantBranding } from "@/lib/tenant/types";

/**
 * Wandelt Tenant-Branding in CSS-Custom-Properties für das <html>-Tag um.
 * Damit greift das Theme (Tailwind-`brand`-Farben lesen diese Variablen) global.
 */
export function brandingToStyle(b: TenantBranding): CSSProperties {
  return {
    "--brand-primary": b.colorPrimary,
    "--brand-accent": b.colorAccent,
    "--brand-primary-fg": b.colorPrimaryFg,
  } as CSSProperties;
}
