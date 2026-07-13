/**
 * Validierung für Branding-Eingaben — bewusst von Hand (kein Zod im Projekt).
 *
 * Farben landen als CSS-Custom-Properties im Inline-Style des <html>-Tags.
 * Deshalb STRIKTES Hex-Whitelisting (#rgb | #rrggbb, case-insensitive) statt
 * "irgendein CSS-Farbwert": alles andere (rgb(), Keywords, …) wird abgelehnt,
 * damit niemals CSS-Injection-Payloads wie "red;}body{…" durchrutschen.
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Ist der Wert eine strikte Hex-Farbe (#rgb oder #rrggbb)? */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/** Die drei pflegbaren Branding-Farben (Teilmenge von TenantBranding). */
export interface BrandingColors {
  colorPrimary: string;
  colorAccent: string;
  colorPrimaryFg: string;
}

/**
 * Prüft einen unbekannten Request-Body auf exakt die drei Branding-Farben.
 * Gibt das validierte Objekt zurück oder `null` (Aufrufer → 400).
 */
export function parseBrandingColors(body: unknown): BrandingColors | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isHexColor(b.colorPrimary) || !isHexColor(b.colorAccent) || !isHexColor(b.colorPrimaryFg)) {
    return null;
  }
  return {
    colorPrimary: b.colorPrimary,
    colorAccent: b.colorAccent,
    colorPrimaryFg: b.colorPrimaryFg,
  };
}

/** Fürs Logo erlaubte Bildtypen. SVG ist BEWUSST verboten: SVG kann Skripte
 *  (<script>, Event-Handler) enthalten und wäre als same-origin ausgeliefertes
 *  Dokument ein XSS-Vektor — Raster-Formate haben dieses Problem nicht. */
export const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoContentType = (typeof ALLOWED_LOGO_TYPES)[number];

/** Max. Logo-Größe: 1 MB (Content-Length UND tatsächliche Bytes prüfen). */
export const MAX_LOGO_BYTES = 1024 * 1024;

/**
 * Erkennt den Bildtyp an den Magic Bytes — die Content-Type-Angabe des Clients
 * ist nur eine Behauptung. `null` = kein erlaubtes Format.
 *  - PNG : 89 50 4E 47
 *  - JPEG: FF D8 FF
 *  - WebP: "RIFF" ???? "WEBP"
 */
export function sniffImageType(bytes: Uint8Array): LogoContentType | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
