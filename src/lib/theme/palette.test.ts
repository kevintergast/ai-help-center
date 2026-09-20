import { describe, expect, it } from "vitest";
import { parseThemeInput, readThemeConfig, serializeThemeConfig, THEME_CONFIG_VERSION } from "./palette";
import { DEFAULT_ANCHORS, generateTheme } from "./generate";
import { DARK_DEFAULTS, LIGHT_DEFAULTS, THEME_TOKEN_KEYS } from "./tokens";

const theme = generateTheme(DEFAULT_ANCHORS);
const valid = { anchors: DEFAULT_ANCHORS, light: theme.light, dark: theme.dark };

describe("readThemeConfig (tolerant)", () => {
  it("liest, was serializeThemeConfig geschrieben hat", () => {
    expect(readThemeConfig(serializeThemeConfig(valid))).toEqual(valid);
  });

  it("gibt null für „keine eigene Farbwelt“", () => {
    expect(readThemeConfig(null)).toBeNull();
    expect(readThemeConfig("")).toBeNull();
  });

  it("lässt eine kaputte Zeile nicht zum Fehler werden", () => {
    // Eine unlesbare Spalte darf das Hilfezentrum nicht abschalten.
    expect(readThemeConfig("{kein json")).toBeNull();
    expect(readThemeConfig("[]")).toBeNull();
    expect(readThemeConfig('"text"')).toBeNull();
  });

  it("ignoriert eine fremde Version, statt sie halb zu deuten", () => {
    const raw = JSON.stringify({ ...valid, v: THEME_CONFIG_VERSION + 1 });
    expect(readThemeConfig(raw)).toBeNull();
  });

  it("füllt einen fehlenden Token aus dem Standard des Modus", () => {
    // Genau der Fall, der beim Hinzufügen eines neuen Tokens eintritt: die
    // gespeicherte Farbwelt eines Kunden darf davon nicht entwertet werden.
    const { page: _dropLight, ...light } = valid.light;
    const { ink: _dropDark, ...dark } = valid.dark;
    const raw = JSON.stringify({ v: THEME_CONFIG_VERSION, anchors: valid.anchors, light, dark });
    const read = readThemeConfig(raw);
    expect(read?.light.page).toBe(LIGHT_DEFAULTS.page);
    expect(read?.dark.ink).toBe(DARK_DEFAULTS.ink);
  });

  it("wirft einen ungültigen Wert weg, statt ihn durchzureichen", () => {
    const raw = JSON.stringify({
      v: THEME_CONFIG_VERSION,
      anchors: valid.anchors,
      light: { ...valid.light, ink: "red;}body{display:none" },
      dark: valid.dark,
    });
    expect(readThemeConfig(raw)?.light.ink).toBe(LIGHT_DEFAULTS.ink);
  });

  it("lässt keine fremden Schlüssel durch", () => {
    const raw = JSON.stringify({
      v: THEME_CONFIG_VERSION,
      anchors: valid.anchors,
      light: { ...valid.light, "evil-token": "#ff0000" },
      dark: valid.dark,
    });
    expect(Object.keys(readThemeConfig(raw)!.light).sort()).toEqual([...THEME_TOKEN_KEYS].sort());
  });
});

describe("parseThemeInput (strikt)", () => {
  it("nimmt eine vollständige Farbwelt an und kanonisiert sie", () => {
    const res = parseThemeInput({
      ...valid,
      light: { ...valid.light, page: "#ABC" },
    });
    expect(res.ok).toBe(true);
    expect(res.config?.light.page).toBe("#aabbcc");
  });

  it("lehnt einen fehlenden Token ab, statt ihn stillschweigend zu ergänzen", () => {
    const { page: _drop, ...light } = valid.light;
    const res = parseThemeInput({ ...valid, light });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("invalid_color");
    expect(res.token).toBe("page");
  });

  it("lehnt jeden Wert ab, der kein Hex ist", () => {
    for (const bad of ["red", "rgb(0,0,0)", "#ff", "var(--ink)", "#fff;}body{x:y", 5, null]) {
      const res = parseThemeInput({ ...valid, dark: { ...valid.dark, ink: bad } });
      expect(res.ok, String(bad)).toBe(false);
      expect(res.error).toBe("invalid_color");
    }
  });

  it("verlangt gültige Anker", () => {
    expect(parseThemeInput({ ...valid, anchors: undefined }).error).toBe("invalid_anchors");
    expect(parseThemeInput({ ...valid, anchors: { ...DEFAULT_ANCHORS, neutral: "pink" } }).error).toBe(
      "invalid_anchors",
    );
    expect(parseThemeInput({ ...valid, anchors: { ...DEFAULT_ANCHORS, brand: "red" } }).error).toBe(
      "invalid_anchors",
    );
  });

  it("lehnt ab, was gar kein Objekt ist", () => {
    expect(parseThemeInput(null).error).toBe("invalid_shape");
    expect(parseThemeInput("…").error).toBe("invalid_shape");
  });
});
