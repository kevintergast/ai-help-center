import { isHexColor, normalizeHex } from "./color";
import {
  DEFAULT_ANCHORS,
  isNeutralTone,
  isSurfaceStyle,
  type ThemeAnchors,
} from "./generate";
import {
  THEME_TOKEN_KEYS,
  defaultsFor,
  type ThemeMode,
  type ThemePalette,
  type ThemeTokenKey,
} from "./tokens";

/**
 * SPEICHERFORMAT der Farbwelt einer Instanz (Migration 0045, Spalte
 * `tenants.theme`). Ein JSON-Objekt statt 48 Spalten: die Farbwelt wird immer
 * als Ganzes gelesen und als Ganzes geschrieben (dasselbe Ersetze-den-Satz-
 * Muster wie Einstiegskarten, Kontaktwege, Kopfzeilen-Knöpfe).
 *
 * `anchors` liegt mit im Dokument, damit der Generator beim nächsten Öffnen
 * dort weitermacht, wo der Kunde aufgehört hat — sonst müsste die UI die vier
 * Angaben aus 48 Farbwerten zurückrechnen, was nicht eindeutig ginge.
 *
 * LESEN IST TOLERANT, SCHREIBEN IST STRIKT (wie bei den Artikel-Symbolen):
 * Ein Token, das wir später hinzufügen, darf die gespeicherte Farbwelt eines
 * Kunden nicht entwerten — beim Lesen füllt der Standard die Lücke. Beim
 * Schreiben dagegen wird jeder Wert geprüft, damit nie etwas anderes als
 * `#rrggbb` in die Datenbank und von dort in einen <style>-Block gelangt.
 */

export const THEME_CONFIG_VERSION = 1;

export interface ThemeConfig {
  anchors: ThemeAnchors;
  light: ThemePalette;
  dark: ThemePalette;
}

function readAnchors(raw: unknown): ThemeAnchors {
  const a = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    brand: normalizeHex(a.brand) ?? DEFAULT_ANCHORS.brand,
    accent: normalizeHex(a.accent) ?? DEFAULT_ANCHORS.accent,
    neutral: isNeutralTone(a.neutral) ? a.neutral : DEFAULT_ANCHORS.neutral,
    surface: isSurfaceStyle(a.surface) ? a.surface : DEFAULT_ANCHORS.surface,
  };
}

/** Tolerant: unbekannte Schlüssel fallen weg, fehlende/ungültige Werte kommen
 *  aus dem Standard des jeweiligen Modus. */
function readPalette(raw: unknown, mode: ThemeMode): ThemePalette {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const fallback = defaultsFor(mode);
  const out = {} as ThemePalette;
  for (const key of THEME_TOKEN_KEYS) {
    out[key] = normalizeHex(src[key]) ?? fallback[key];
  }
  return out;
}

/**
 * Gespeicherten Spaltenwert lesen. `null`/kaputt/fremde Version ⇒ `null` =
 * „diese Instanz hat keine eigene Farbwelt" (das Standard-Theme aus
 * globals.css gilt). Bewusst kein Werfen: eine unlesbare Zeile darf das
 * Hilfezentrum nicht abschalten.
 */
export function readThemeConfig(raw: string | null | undefined): ThemeConfig | null {
  if (!raw) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) return null;
  const d = doc as Record<string, unknown>;
  if (d.v !== THEME_CONFIG_VERSION) return null;
  return {
    anchors: readAnchors(d.anchors),
    light: readPalette(d.light, "light"),
    dark: readPalette(d.dark, "dark"),
  };
}

export function serializeThemeConfig(config: ThemeConfig): string {
  return JSON.stringify({
    v: THEME_CONFIG_VERSION,
    anchors: config.anchors,
    light: config.light,
    dark: config.dark,
  });
}

export type ThemeInputError = "invalid_shape" | "invalid_color" | "invalid_anchors";

export interface ThemeInputResult {
  ok: boolean;
  config?: ThemeConfig;
  error?: ThemeInputError;
  /** Welcher Token es war — die UI zeigt darauf, statt „ungültig" zu sagen. */
  token?: string;
}

/** Strikt: JEDER der 24 Tokens muss je Modus als Hex dastehen. */
function strictPalette(raw: unknown): { palette?: ThemePalette; bad?: ThemeTokenKey | null } {
  if (typeof raw !== "object" || raw === null) return { bad: null };
  const src = raw as Record<string, unknown>;
  const out = {} as ThemePalette;
  for (const key of THEME_TOKEN_KEYS) {
    if (!isHexColor(src[key])) return { bad: key };
    out[key] = normalizeHex(src[key]) as string;
  }
  return { palette: out };
}

/** Eingabe der Admin-API/-UI prüfen. Gibt die kanonisierte Farbwelt zurück. */
export function parseThemeInput(body: unknown): ThemeInputResult {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_shape" };
  const b = body as Record<string, unknown>;

  const a = (typeof b.anchors === "object" && b.anchors !== null ? b.anchors : null) as Record<
    string,
    unknown
  > | null;
  if (!a || !isHexColor(a.brand) || !isHexColor(a.accent) || !isNeutralTone(a.neutral) || !isSurfaceStyle(a.surface)) {
    return { ok: false, error: "invalid_anchors" };
  }

  const light = strictPalette(b.light);
  if (!light.palette) return { ok: false, error: "invalid_color", token: light.bad ?? "light" };
  const dark = strictPalette(b.dark);
  if (!dark.palette) return { ok: false, error: "invalid_color", token: dark.bad ?? "dark" };

  return {
    ok: true,
    config: {
      anchors: {
        brand: normalizeHex(a.brand) as string,
        accent: normalizeHex(a.accent) as string,
        neutral: a.neutral,
        surface: a.surface,
      },
      light: light.palette,
      dark: dark.palette,
    },
  };
}
