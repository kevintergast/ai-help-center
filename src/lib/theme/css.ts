import type { TenantBranding } from "@/lib/tenant/types";
import { hexToRgb, normalizeHex } from "./color";
import type { ThemeConfig } from "./palette";
import { THEME_TOKEN_KEYS, type ThemePalette } from "./tokens";

/**
 * AUSLIEFERUNG der Farbwelt als <style>-Block im <head>.
 *
 * WARUM NICHT MEHR INLINE AUF <html>: Ein Inline-Style kennt keine Bedingung.
 * Er überstimmt Hell- UND Dunkel-Block gleichermaßen — genau deshalb konnte
 * eine Instanz bisher nur EINEN Farbsatz für beide Modi haben (die alte
 * Entscheidung stand in brand.ts). Getrennte Modi brauchen echte Regeln.
 *
 * KASKADE: Jeder Selektor trägt `:root` doppelt. Das hebt die Spezifität
 * gegenüber dem jeweiligen Gegenstück in globals.css um genau eine Stufe an —
 * damit gewinnt der Tenant-Block UNABHÄNGIG von der Reihenfolge, in der
 * Next.js Stylesheet und <style> in den <head> schreibt. Untereinander bleibt
 * die Staffelung wie in globals.css: Hell (0,2,0) < Dunkel (0,3,0), und
 * erzwungenes Dunkel steht nach dem Media-Block, gewinnt also bei Gleichstand.
 *
 * SICHERHEIT: In den Block gelangen ausschließlich Werte, die `normalizeHex`
 * passiert haben — `#rrggbb`, sonst nichts. Ein Wert wie `red;}body{display:none`
 * wird nicht etwa maskiert, sondern fällt ganz weg; dann gilt für diesen Token
 * der Standard aus globals.css. Es gibt keinen Pfad, auf dem Mandanten-Eingabe
 * zu CSS-Struktur werden kann.
 */

const LIGHT_SELECTOR = ":root:root";
const DARK_MEDIA_SELECTOR = ':root:root:not([data-theme="light"])';
const DARK_FORCED_SELECTOR = ':root:root[data-theme="dark"]';

/** Deckkraft des Fokusrings — wie im Standard-Theme (globals.css). */
const RING_ALPHA = 0.55;

/**
 * Der Fokusring wird aus der Marken-Farbe abgeleitet statt gepflegt: Ein Ring,
 * der nicht zur Marke passt, ist ein Fehler und kein Gestaltungsspielraum.
 */
export function ringFrom(brandPrimary: string): string {
  const { r, g, b } = hexToRgb(brandPrimary);
  return `rgba(${r}, ${g}, ${b}, ${RING_ALPHA})`;
}

function declarations(entries: readonly (readonly [string, string])[]): string {
  return entries.map(([name, value]) => `--${name}:${value};`).join("");
}

/** Alle 24 Tokens + abgeleiteter Ring. Ungültige Werte fallen weg. */
export function paletteDeclarations(palette: ThemePalette): string {
  const entries: (readonly [string, string])[] = [];
  for (const key of THEME_TOKEN_KEYS) {
    const value = normalizeHex(palette[key]);
    if (value) entries.push([key, value]);
  }
  const brand = normalizeHex(palette["brand-primary"]);
  if (brand) entries.push(["ring", ringFrom(brand)]);
  return declarations(entries);
}

/** Nur die drei Marken-Tokens (Instanz ohne eigene Farbwelt). */
function brandDeclarations(b: TenantBranding): string {
  const entries: (readonly [string, string])[] = [];
  const primary = normalizeHex(b.colorPrimary);
  const accent = normalizeHex(b.colorAccent);
  const fg = normalizeHex(b.colorPrimaryFg);
  if (primary) entries.push(["brand-primary", primary]);
  if (accent) entries.push(["brand-accent", accent]);
  if (fg) entries.push(["brand-primary-fg", fg]);
  if (primary) entries.push(["ring", ringFrom(primary)]);
  return declarations(entries);
}

function blocks(lightDecls: string, darkDecls: string): string {
  const parts: string[] = [];
  if (lightDecls) parts.push(`${LIGHT_SELECTOR}{${lightDecls}}`);
  if (darkDecls) {
    parts.push(`@media (prefers-color-scheme:dark){${DARK_MEDIA_SELECTOR}{${darkDecls}}}`);
    parts.push(`${DARK_FORCED_SELECTOR}{${darkDecls}}`);
  }
  return parts.join("");
}

/**
 * Der CSS-Block für eine Instanz. Ohne eigene Farbwelt bleibt es beim
 * bisherigen Verhalten: die drei Marken-Tokens gelten in BEIDEN Modi gleich
 * (identische Deklarationen in Hell- und Dunkel-Block) — so, wie es der
 * Inline-Style vorher erzwungen hat. Leerer String = nichts zu setzen.
 */
export function tenantThemeCss(branding: TenantBranding, theme: ThemeConfig | null | undefined): string {
  if (theme) return blocks(paletteDeclarations(theme.light), paletteDeclarations(theme.dark));
  const decls = brandDeclarations(branding);
  return blocks(decls, decls);
}

/**
 * Für die Vorschau im Verwaltungsbereich: dieselben Werte als Inline-Style-
 * Objekt auf einem Wrapper. Dort ist EIN Modus gleichzeitig zu sehen, also
 * reicht (und passt) der Inline-Weg — der Grund gegen ihn im Dokument oben
 * betrifft nur das globale, modusabhängige Ausliefern.
 */
export function paletteToStyle(palette: ThemePalette): Record<string, string> {
  const style: Record<string, string> = {};
  for (const key of THEME_TOKEN_KEYS) {
    const value = normalizeHex(palette[key]);
    if (value) style[`--${key}`] = value;
  }
  const brand = normalizeHex(palette["brand-primary"]);
  if (brand) style["--ring"] = ringFrom(brand);
  return style;
}
