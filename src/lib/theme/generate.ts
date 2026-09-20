import {
  blackOrWhite,
  contrastRatio,
  ensureContrast,
  hslToRgb,
  hexToRgb,
  normalizeHex,
  rgbToHex,
  rgbToHsl,
} from "./color";
import { CONTRAST_LEVELS } from "./contrast";
import { LIGHT_DEFAULTS, type ThemeMode, type ThemePalette } from "./tokens";

/**
 * DER GENERATOR: aus vier Angaben eine vollständige Farbwelt für beide Modi.
 *
 * Er erzeugt IMMER beide Modi auf einen Schlag — das ist seine Aufgabe. Wer
 * Hell und Dunkel unabhängig voneinander will, justiert danach von Hand
 * nach (die Modi werden getrennt gespeichert, das Nachjustieren im einen
 * fasst den anderen nicht an).
 *
 * VERSPRECHEN: Was `auditPalette` prüft, erfüllt der Generator. Nicht mehr
 * und nicht weniger — eine Ableitung, die Kontraste herstellt, die niemand
 * nachprüft, wäre nur Behauptung. Der Test `generate.test.ts` fährt ein
 * Raster aus Marken-Farben durch und besteht auf null Beanstandungen.
 *
 * PREIS: Die Marken-Farbe kann sich verschieben. `--brand-primary` ist im
 * Hilfezentrum auch Link-Farbe auf heller Fläche; ein zartes Gelb bleibt als
 * Fließtext unlesbar, egal wie sehr es die Marke ist. Der Generator dunkelt
 * dann farbtontreu ab. Wer das nicht will, setzt den Token danach von Hand
 * zurück — die Warnung bleibt dann stehen, und das ist der ehrliche Zustand.
 */

export const NEUTRAL_TONES = ["cool", "neutral", "warm"] as const;
export type NeutralTone = (typeof NEUTRAL_TONES)[number];

export const SURFACE_STYLES = ["plain", "tinted"] as const;
export type SurfaceStyle = (typeof SURFACE_STYLES)[number];

export interface ThemeAnchors {
  /** Marken-Farbe: Knöpfe, Links, Hervorhebungen. */
  brand: string;
  /** Zweitfarbe für Akzente (Verläufe, Marker). */
  accent: string;
  /** Temperatur der Grautöne — das Grundgerüst. */
  neutral: NeutralTone;
  /** Flächen rein neutral oder leicht in der Neutral-Temperatur getönt. */
  surface: SurfaceStyle;
}

export const DEFAULT_ANCHORS: ThemeAnchors = {
  brand: LIGHT_DEFAULTS["brand-primary"],
  accent: LIGHT_DEFAULTS["brand-accent"],
  neutral: "cool",
  surface: "plain",
};

export function isNeutralTone(v: unknown): v is NeutralTone {
  return typeof v === "string" && (NEUTRAL_TONES as readonly string[]).includes(v);
}

export function isSurfaceStyle(v: unknown): v is SurfaceStyle {
  return typeof v === "string" && (SURFACE_STYLES as readonly string[]).includes(v);
}

/** Farbton + Sättigung der Grauleiter je Temperatur. */
const NEUTRAL: Record<NeutralTone, { h: number; s: number }> = {
  cool: { h: 220, s: 14 },
  neutral: { h: 0, s: 0 },
  warm: { h: 32, s: 12 },
};

/**
 * Die Helligkeitsleitern. Sie sind der eigentliche Entwurf — alles andere ist
 * Rechnen. Die Abstände sind so gewählt, dass die Flächen-Hierarchie auch bei
 * `neutral` (Sättigung 0) noch als Stufe wahrnehmbar bleibt.
 */
const LADDER: Record<ThemeMode, Record<SurfaceStyle, Record<string, number>>> = {
  light: {
    plain: { surface: 100, "surface-2": 98.6, page: 96.2, tint: 94.2, border: 90, "border-strong": 82, ink: 11, muted: 45 },
    tinted: { surface: 99.2, "surface-2": 97.8, page: 95, tint: 92.6, border: 88.5, "border-strong": 80, ink: 12, muted: 44 },
  },
  dark: {
    plain: { surface: 10, "surface-2": 13.2, page: 4.5, tint: 16.5, border: 20.5, "border-strong": 30, ink: 91, muted: 68 },
    tinted: { surface: 11.5, "surface-2": 14.5, page: 6.5, tint: 18, border: 22, "border-strong": 31, ink: 90, muted: 67 },
  },
};

/** Feste Farbtöne der Semantik — bewusst UNABHÄNGIG von der Marke: Rot muss
 *  Warnung heißen, auch wenn die Marke rot ist. */
const SEMANTIC_HUES = { info: 217, ok: 152, warn: 38, crit: 4 } as const;

function grey(tone: NeutralTone, l: number): string {
  const { h, s } = NEUTRAL[tone];
  return rgbToHex(hslToRgb({ h, s, l }));
}

function hsl(h: number, s: number, l: number): string {
  return rgbToHex(hslToRgb({ h, s, l }));
}

/**
 * Hebt/senkt `fg`, bis es gegen JEDEN der Hintergründe reicht. Mehrere Runden,
 * weil `ensureContrast` je Aufruf nur einen Hintergrund kennt; bei gleichartig
 * hellen (oder gleichartig dunklen) Gründen konvergiert das nach einer Runde.
 */
function ensureAgainst(fg: string, backgrounds: readonly string[], min: number): string {
  let out = normalizeHex(fg) ?? fg;
  for (let round = 0; round < 4; round++) {
    const worst = backgrounds.find((bg) => contrastRatio(out, bg) < min);
    if (!worst) return out;
    out = ensureContrast(out, worst, min);
  }
  return out;
}

const TEXT = CONTRAST_LEVELS.text;

/** Akzent-Schwelle: Der Akzent trägt keinen Fließtext (Verläufe, Marker,
 *  Diagramm-Flächen) — 3:1 hält ihn wahrnehmbar, ohne ihn auf Textfarbe
 *  einzudampfen. Deshalb steht er auch nicht in CONTRAST_CHECKS. */
const ACCENT_MIN = 3;

export function generatePalette(anchors: ThemeAnchors, mode: ThemeMode): ThemePalette {
  const { neutral, surface: style } = anchors;
  const l = LADDER[mode][style];
  const dark = mode === "dark";

  const surface = dark || style === "tinted" ? grey(neutral, l.surface) : "#ffffff";
  const surface2 = grey(neutral, l["surface-2"]);
  const page = grey(neutral, l.page);
  const tint = grey(neutral, l.tint);

  const ink = ensureAgainst(grey(neutral, l.ink), [surface, page, surface2], TEXT);
  const muted = ensureAgainst(grey(neutral, l.muted), [surface, page], TEXT);

  // Im Dunkeln muss die Marke erst ins Helle: eine mitteldunkle Marken-Farbe
  // auf fast schwarzem Grund ist als Link nicht lesbar. Erst anheben, dann
  // prüfen — sonst würde `ensureContrast` sie nur minimal aufhellen und der
  // Ton kippte ins Stumpfe.
  const brandBase = dark ? liftForDark(anchors.brand) : anchors.brand;
  const accentBase = dark ? liftForDark(anchors.accent) : anchors.accent;

  const brandPrimary = ensureAgainst(brandBase, [surface], TEXT);
  const brandAccent = ensureAgainst(accentBase, [surface], ACCENT_MIN);
  const brandPrimaryFg = ensureContrast(blackOrWhite(brandPrimary), brandPrimary, TEXT);

  // Der Hochkontrast-Knopf ist bewusst die Umkehrung der Textfarbe, nicht die
  // Marke: zwei „wichtigste" Knöpfe in einer Ansicht heben sich gegenseitig auf.
  const btnBg = ink;
  const btnFg = ensureContrast(blackOrWhite(btnBg), btnBg, TEXT);

  const sem = (hue: number): { fg: string; bg: string; bd: string } => {
    const bg = dark ? hsl(hue, 45, 11) : hsl(hue, 85, 96.5);
    const bd = dark ? hsl(hue, 40, 22) : hsl(hue, 78, 78);
    const fg = ensureAgainst(dark ? hsl(hue, 90, 72) : hsl(hue, 78, 32), [bg], TEXT);
    return { fg, bg, bd };
  };
  const info = sem(SEMANTIC_HUES.info);
  const ok = sem(SEMANTIC_HUES.ok);
  const warn = sem(SEMANTIC_HUES.warn);
  const crit = sem(SEMANTIC_HUES.crit);

  return {
    page,
    surface,
    "surface-2": surface2,
    tint,
    ink,
    muted,
    border: grey(neutral, l.border),
    "border-strong": grey(neutral, l["border-strong"]),
    "brand-primary": brandPrimary,
    "brand-accent": brandAccent,
    "brand-primary-fg": brandPrimaryFg,
    "btn-primary-bg": btnBg,
    "btn-primary-fg": btnFg,
    "sem-info": info.fg,
    "sem-info-bg": info.bg,
    "sem-ok": ok.fg,
    "sem-ok-bg": ok.bg,
    "sem-ok-bd": ok.bd,
    "sem-warn": warn.fg,
    "sem-warn-bg": warn.bg,
    "sem-warn-bd": warn.bd,
    "sem-crit": crit.fg,
    "sem-crit-bg": crit.bg,
    "sem-crit-bd": crit.bd,
  };
}

/** Marken-/Akzentfarbe für dunklen Grund anheben — farbtontreu, mit gedeckelter
 *  Sättigung: vollgesättigte Töne flirren auf Schwarz. */
function liftForDark(hex: string): string {
  const h = rgbToHsl(hexToRgb(normalizeHex(hex) ?? "#000000"));
  return rgbToHex(hslToRgb({ h: h.h, s: Math.min(h.s, 85), l: Math.max(h.l, 62) }));
}

export function generateTheme(anchors: ThemeAnchors): { light: ThemePalette; dark: ThemePalette } {
  return {
    light: generatePalette(anchors, "light"),
    dark: generatePalette(anchors, "dark"),
  };
}
