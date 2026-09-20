/**
 * Farbmathematik für den Theme-Generator.
 *
 * Bewusst ohne Bibliothek: Wir brauchen genau vier Dinge — Hex parsen, HSL für
 * farbtontreues Auf-/Abdunkeln, WCAG-Kontrast und Mischen. Das sind ~100
 * Zeilen; eine Abhängigkeit (chroma.js, culori) wäre im Worker-Bundle teurer
 * als der Code selbst und müsste gepflegt werden.
 *
 * SICHERHEIT: `isHexColor` ist die EINZIGE Stelle, an der entschieden wird,
 * was als Farbe gilt. Farbwerte landen in einem <style>-Block (Theme) bzw. im
 * Inline-Style des <html>-Tags — striktes Hex-Whitelisting verhindert, dass
 * jemals ein CSS-Injection-Payload wie "red;}body{…" durchrutscht.
 */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Ist der Wert eine strikte Hex-Farbe (#rgb oder #rrggbb)? */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Kanonisiert auf "#rrggbb" in Kleinschrift. Alles, was nicht `isHexColor`
 * erfüllt, ergibt `null` — Aufrufer entscheiden über den Rückfall.
 */
export function normalizeHex(value: unknown): string | null {
  if (!isHexColor(value)) return null;
  const hex = value.slice(1).toLowerCase();
  if (hex.length === 3) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  return `#${hex}`;
}

export function hexToRgb(hex: string): Rgb {
  const n = normalizeHex(hex) ?? "#000000";
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number): string => clamp255(n).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/* ------------------------------------------------------------------ HSL */

export interface Hsl {
  /** 0–360 */
  h: number;
  /** 0–100 */
  s: number;
  /** 0–100 */
  l: number;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;

  if (d === 0) return { h: 0, s: 0, l: l * 100 };

  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;

  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = ln - c / 2;

  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
}

/** Farbtontreu auf eine Ziel-Helligkeit setzen (0–100). */
export function withLightness(hex: string, l: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, l }));
}

/** Farbtontreu auf eine Ziel-Sättigung setzen (0–100). */
export function withSaturation(hex: string, s: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, s }));
}

/** Lineare Mischung im sRGB-Raum; `t` = 0 → `a`, 1 → `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex({
    r: x.r + (y.r - x.r) * k,
    g: x.g + (y.g - x.g) * k,
    b: x.b + (y.b - x.b) * k,
  });
}

/* -------------------------------------------------------------- Kontrast */

/** Relative Leuchtdichte nach WCAG 2.1 (sRGB-Linearisierung). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG-Kontrastverhältnis, 1–21. Reihenfolge der Argumente egal. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Auf eine Nachkommastelle — für Anzeige UND Vergleich, damit die angezeigte
 *  Zahl nie einer Warnung widerspricht („4.5 ⚠" wäre sonst möglich). */
export function roundRatio(ratio: number): number {
  return Math.round(ratio * 10) / 10;
}

/** Schwarz oder Weiß — was auf diesem Grund besser lesbar ist. */
export function blackOrWhite(background: string): string {
  return contrastRatio("#ffffff", background) >= contrastRatio("#000000", background)
    ? "#ffffff"
    : "#000000";
}

/**
 * Hebt `foreground` farbtontreu so weit an oder ab, bis der Kontrast zu
 * `background` mindestens `min` beträgt. Gibt es keine Helligkeit, die das
 * schafft (sehr gesättigte Töne auf mittlerem Grund), fällt die Funktion auf
 * Schwarz/Weiß zurück — lieber ein Ton daneben als unlesbar.
 */
export function ensureContrast(foreground: string, background: string, min: number): string {
  if (contrastRatio(foreground, background) >= min) return normalizeHex(foreground) ?? foreground;

  const hsl = rgbToHsl(hexToRgb(foreground));
  // Auf dunklem Grund nach oben, auf hellem nach unten — die andere Richtung
  // kann den Kontrast nicht verbessern.
  const up = relativeLuminance(background) < 0.5;

  for (let step = 1; step <= 100; step++) {
    const l = up ? hsl.l + step : hsl.l - step;
    if (l < 0 || l > 100) break;
    const candidate = rgbToHex(hslToRgb({ ...hsl, l }));
    if (contrastRatio(candidate, background) >= min) return candidate;
  }
  return blackOrWhite(background);
}
