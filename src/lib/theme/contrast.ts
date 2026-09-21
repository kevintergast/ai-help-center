import { contrastRatio, roundRatio } from "./color";
import type { ThemePalette, ThemeTokenKey } from "./tokens";

/**
 * KONTROLLE DER LESBARKEIT.
 *
 * Wer jeden Token frei setzen darf, kann sich unlesbar machen. Wir verhindern
 * das NICHT (es gibt legitime Sonderfälle), aber wir zeigen es — an genau den
 * Paaren, die im Hilfezentrum wirklich übereinanderliegen. Eine Prüfung aller
 * 24×24 Kombinationen wäre Lärm: die meisten treffen nie aufeinander.
 *
 * Zwei Stufen:
 *   text       4.5:1 — WCAG 2.1 AA für Fließtext.
 *   structure  1.05  — kein WCAG-Kriterium, sondern unsere Flächen-Hierarchie:
 *                      Sind --page und --surface gleich, verschwindet die
 *                      Gliederung, die das Redesign überhaupt erst gebracht
 *                      hat (Begründung in globals.css). Dasselbe gilt für
 *                      Hover-Tönung und Linien: unsichtbar = wirkungslos.
 *
 * KEINE 3:1-Stufe (WCAG 1.4.11, Grenzen von Bedienelementen), obwohl sie
 * naheläge: Unser eigenes Standard-Theme erfüllt sie an --border-strong nicht
 * (#cdd2da auf Weiß = 1.45:1) — die Linien sind hier Feinschliff, die
 * Abgrenzung trägt die FLÄCHE. Eine Warnung, die schon beim unveränderten
 * Standard leuchtet, bringt man Leuten bei zu übersehen; dann übersehen sie
 * auch die echten. Lieber wenige Warnungen, die etwas bedeuten.
 */

export const CONTRAST_LEVELS = {
  text: 4.5,
  structure: 1.05,
} as const;

export type ContrastLevel = keyof typeof CONTRAST_LEVELS;

export interface ContrastCheck {
  fg: ThemeTokenKey;
  bg: ThemeTokenKey;
  level: ContrastLevel;
}

export const CONTRAST_CHECKS: readonly ContrastCheck[] = [
  { fg: "ink", bg: "surface", level: "text" },
  { fg: "ink", bg: "page", level: "text" },
  { fg: "ink", bg: "surface-2", level: "text" },
  { fg: "muted", bg: "surface", level: "text" },
  { fg: "muted", bg: "page", level: "text" },
  { fg: "brand-primary", bg: "surface", level: "text" },
  { fg: "brand-primary-fg", bg: "brand-primary", level: "text" },
  { fg: "btn-primary-fg", bg: "btn-primary-bg", level: "text" },
  { fg: "sem-info", bg: "sem-info-bg", level: "text" },
  { fg: "sem-ok", bg: "sem-ok-bg", level: "text" },
  { fg: "sem-warn", bg: "sem-warn-bg", level: "text" },
  { fg: "sem-crit", bg: "sem-crit-bg", level: "text" },
  { fg: "page", bg: "surface", level: "structure" },
  { fg: "tint", bg: "surface", level: "structure" },
  { fg: "border", bg: "surface", level: "structure" },
];

export interface ContrastResult extends ContrastCheck {
  /** Auf eine Nachkommastelle gerundet — dieselbe Zahl, die die UI zeigt.
   *  Sonst wären „4.5" und eine Warnung gleichzeitig möglich. */
  ratio: number;
  min: number;
  ok: boolean;
}

export function checkContrast(palette: ThemePalette, check: ContrastCheck): ContrastResult {
  const min = CONTRAST_LEVELS[check.level];
  const ratio = roundRatio(contrastRatio(palette[check.fg], palette[check.bg]));
  return { ...check, ratio, min, ok: ratio >= min };
}

/** Alle Prüfungen für eine Palette; Reihenfolge stabil (= CONTRAST_CHECKS). */
export function auditPalette(palette: ThemePalette): ContrastResult[] {
  return CONTRAST_CHECKS.map((c) => checkContrast(palette, c));
}

/** Nur die Beanstandungen — das, was die UI als Warnung zeigt. */
export function contrastProblems(palette: ThemePalette): ContrastResult[] {
  return auditPalette(palette).filter((r) => !r.ok);
}

/** Betrifft ein Token überhaupt eine Prüfung? (Die UI zeigt nur dort ein
 *  Kontrast-Häkchen, wo es eines gibt — sonst suggeriert sie Prüfungen,
 *  die es nicht gibt.) */
export function checksForToken(token: ThemeTokenKey): readonly ContrastCheck[] {
  return CONTRAST_CHECKS.filter((c) => c.fg === token || c.bg === token);
}
