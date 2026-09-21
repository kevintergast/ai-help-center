/**
 * DAS TOKEN-VERZEICHNIS des Theme-Generators.
 *
 * Quelle der Wahrheit für die Farbwelt bleibt `src/app/globals.css`; die
 * Defaults hier sind dessen exakte Spiegelung. Sie stehen doppelt, weil CSS
 * nicht nach TypeScript importierbar ist — wer dort eine Farbe ändert, ändert
 * sie hier mit (der Test `tokens.test.ts` liest globals.css und vergleicht).
 *
 * NICHT pflegbar und bewusst nicht in dieser Liste:
 *   --shadow-inset / --shadow-focus  Keine Farben, sondern ganze Schatten-
 *       Definitionen. Sie freizugeben hieße, beliebiges CSS zu erlauben — und
 *       genau das schließt das Hex-Whitelisting aus.
 *   --ring  Wird aus --brand-primary abgeleitet (siehe `ringFrom`): ein
 *       Fokusring, der nicht zur Marke passt, ist ein Fehler, kein Feature.
 */

export const THEME_TOKEN_GROUPS = ["surfaces", "text", "lines", "brand", "button", "semantic"] as const;
export type ThemeTokenGroup = (typeof THEME_TOKEN_GROUPS)[number];

export const THEME_TOKENS = [
  { key: "page", group: "surfaces" },
  { key: "surface", group: "surfaces" },
  { key: "surface-2", group: "surfaces" },
  { key: "tint", group: "surfaces" },
  { key: "ink", group: "text" },
  { key: "muted", group: "text" },
  { key: "border", group: "lines" },
  { key: "border-strong", group: "lines" },
  { key: "brand-primary", group: "brand" },
  { key: "brand-accent", group: "brand" },
  { key: "brand-primary-fg", group: "brand" },
  { key: "btn-primary-bg", group: "button" },
  { key: "btn-primary-fg", group: "button" },
  { key: "sem-info", group: "semantic" },
  { key: "sem-info-bg", group: "semantic" },
  { key: "sem-ok", group: "semantic" },
  { key: "sem-ok-bg", group: "semantic" },
  { key: "sem-ok-bd", group: "semantic" },
  { key: "sem-warn", group: "semantic" },
  { key: "sem-warn-bg", group: "semantic" },
  { key: "sem-warn-bd", group: "semantic" },
  { key: "sem-crit", group: "semantic" },
  { key: "sem-crit-bg", group: "semantic" },
  { key: "sem-crit-bd", group: "semantic" },
] as const satisfies readonly { key: string; group: ThemeTokenGroup }[];

export type ThemeTokenKey = (typeof THEME_TOKENS)[number]["key"];

/** Vollständige Farbwelt EINES Modus: jeder Token genau einmal, Wert = Hex. */
export type ThemePalette = Record<ThemeTokenKey, string>;

export const THEME_TOKEN_KEYS: readonly ThemeTokenKey[] = THEME_TOKENS.map((t) => t.key);

export function tokensOfGroup(group: ThemeTokenGroup): readonly ThemeTokenKey[] {
  return THEME_TOKENS.filter((t) => t.group === group).map((t) => t.key);
}

/** Spiegelt den `:root`-Block aus globals.css. */
export const LIGHT_DEFAULTS: ThemePalette = {
  page: "#f4f5f7",
  surface: "#ffffff",
  "surface-2": "#fafbfc",
  tint: "#eef0f4",
  ink: "#16181d",
  muted: "#667085",
  border: "#e4e7eb",
  "border-strong": "#cdd2da",
  "brand-primary": "#4f46e5",
  "brand-accent": "#06b6d4",
  "brand-primary-fg": "#ffffff",
  "btn-primary-bg": "#16181d",
  "btn-primary-fg": "#ffffff",
  "sem-info": "#175cd3",
  "sem-info-bg": "#eff6ff",
  "sem-ok": "#067647",
  "sem-ok-bg": "#ecfdf3",
  "sem-ok-bd": "#abefc6",
  "sem-warn": "#b54708",
  "sem-warn-bg": "#fffaeb",
  "sem-warn-bd": "#fedf89",
  "sem-crit": "#b42318",
  "sem-crit-bg": "#fef3f2",
  "sem-crit-bd": "#fecdca",
};

/** Spiegelt den Dark-Block aus globals.css. */
export const DARK_DEFAULTS: ThemePalette = {
  page: "#0b0d11",
  surface: "#14171d",
  "surface-2": "#1b1f27",
  tint: "#232832",
  ink: "#e8eaed",
  muted: "#98a2b3",
  border: "#272c36",
  "border-strong": "#3b4250",
  "brand-primary": "#8b83ff",
  "brand-accent": "#22d3ee",
  "brand-primary-fg": "#16130d",
  "btn-primary-bg": "#e8eaed",
  "btn-primary-fg": "#14171d",
  "sem-info": "#84caff",
  "sem-info-bg": "#101f36",
  "sem-ok": "#75e0a7",
  "sem-ok-bg": "#0d2a1d",
  "sem-ok-bd": "#1a4733",
  "sem-warn": "#fdb022",
  "sem-warn-bg": "#2b1f06",
  "sem-warn-bd": "#4e3a12",
  "sem-crit": "#fda29b",
  "sem-crit-bg": "#2b1513",
  "sem-crit-bd": "#4e2420",
};

export type ThemeMode = "light" | "dark";

export function defaultsFor(mode: ThemeMode): ThemePalette {
  return mode === "dark" ? DARK_DEFAULTS : LIGHT_DEFAULTS;
}
