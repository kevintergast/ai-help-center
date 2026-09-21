import { describe, expect, it } from "vitest";
import { contrastProblems, auditPalette } from "./contrast";
import {
  DEFAULT_ANCHORS,
  NEUTRAL_TONES,
  SURFACE_STYLES,
  generatePalette,
  generateTheme,
  type ThemeAnchors,
} from "./generate";
import { THEME_TOKEN_KEYS } from "./tokens";
import { isHexColor, contrastRatio, rgbToHsl, hexToRgb } from "./color";

/**
 * DAS VERSPRECHEN DES GENERATORS: Was `auditPalette` prüft, hält er ein — für
 * JEDE Marken-Farbe, die ein Kunde eingibt. Ohne diesen Test wäre
 * "kontrastgeprüft" bloß eine Behauptung im Beschreibungstext (genau das war
 * es vorher schon einmal, in zwei MCP-Werkzeugbeschreibungen).
 */

const BRANDS = [
  "#4f46e5", // Indigo (unser Standard)
  "#e11d48", // Rot
  "#059669", // Grün
  "#f59e0b", // Bernstein — auf Weiß von Haus aus zu hell für Text
  "#ffe600", // knallgelb — der harte Fall
  "#000000", // Schwarz
  "#ffffff", // Weiß — der andere harte Fall
  "#123456", // sehr dunkles Blau
  "#8b5cf6",
  "#0ea5e9",
  "#7c2d12",
  "#d946ef",
];

function everyAnchorCombo(): ThemeAnchors[] {
  const out: ThemeAnchors[] = [];
  for (const brand of BRANDS) {
    for (const neutral of NEUTRAL_TONES) {
      for (const surface of SURFACE_STYLES) {
        out.push({ brand, accent: "#06b6d4", neutral, surface });
      }
    }
  }
  return out;
}

describe("generatePalette", () => {
  it("erzeugt für jede Marken-Farbe und jede Grundeinstellung eine Palette ohne Beanstandung", () => {
    for (const anchors of everyAnchorCombo()) {
      for (const mode of ["light", "dark"] as const) {
        const palette = generatePalette(anchors, mode);
        const problems = contrastProblems(palette);
        expect(
          problems.map((p) => `${p.fg} auf ${p.bg}: ${p.ratio} < ${p.min}`),
          `${anchors.brand} / ${anchors.neutral} / ${anchors.surface} / ${mode}`,
        ).toEqual([]);
      }
    }
  });

  it("belegt jeden Token mit gültigem Hex — keine Lücke, kein rgb()", () => {
    const palette = generatePalette(DEFAULT_ANCHORS, "light");
    for (const key of THEME_TOKEN_KEYS) {
      expect(isHexColor(palette[key]), key).toBe(true);
    }
    expect(Object.keys(palette).sort()).toEqual([...THEME_TOKEN_KEYS].sort());
  });

  it("hält den Farbton der Marke, wo der Kontrast es zulässt", () => {
    // Indigo reicht auf Weiß bereits — es darf unverändert durchgehen.
    expect(generatePalette(DEFAULT_ANCHORS, "light")["brand-primary"]).toBe("#4f46e5");
  });

  it("dunkelt eine zu helle Marken-Farbe ab, statt sie unlesbar zu lassen", () => {
    const palette = generatePalette({ ...DEFAULT_ANCHORS, brand: "#ffe600" }, "light");
    expect(palette["brand-primary"]).not.toBe("#ffe600");
    expect(contrastRatio(palette["brand-primary"], palette.surface)).toBeGreaterThanOrEqual(4.5);
    // …aber farbtontreu: Gelb bleibt Gelb, es wird nicht grau.
    const hue = rgbToHsl(hexToRgb(palette["brand-primary"])).h;
    expect(Math.abs(hue - rgbToHsl(hexToRgb("#ffe600")).h)).toBeLessThan(6);
  });

  it("hebt eine dunkle Marken-Farbe für den Dunkelmodus an", () => {
    const dark = generatePalette({ ...DEFAULT_ANCHORS, brand: "#123456" }, "dark");
    const light = generatePalette({ ...DEFAULT_ANCHORS, brand: "#123456" }, "light");
    expect(rgbToHsl(hexToRgb(dark["brand-primary"])).l).toBeGreaterThan(
      rgbToHsl(hexToRgb(light["brand-primary"])).l,
    );
  });

  it("lässt die Semantik-Töne von der Marke unberührt — Rot muss Warnung heißen", () => {
    const red = generatePalette({ ...DEFAULT_ANCHORS, brand: "#e11d48" }, "light");
    const green = generatePalette({ ...DEFAULT_ANCHORS, brand: "#059669" }, "light");
    expect(red["sem-crit"]).toBe(green["sem-crit"]);
    expect(red["sem-ok"]).toBe(green["sem-ok"]);
  });

  it("gibt dem Dunkelmodus dunkle Flächen und helle Schrift", () => {
    const dark = generatePalette(DEFAULT_ANCHORS, "dark");
    expect(rgbToHsl(hexToRgb(dark.surface)).l).toBeLessThan(20);
    expect(rgbToHsl(hexToRgb(dark.ink)).l).toBeGreaterThan(80);
    // Die Flächen-Hierarchie kehrt sich um: page liegt HINTER surface.
    expect(rgbToHsl(hexToRgb(dark.page)).l).toBeLessThan(rgbToHsl(hexToRgb(dark.surface)).l);
  });

  it("hält die Flächen-Hierarchie im Hellen: page liegt hinter surface", () => {
    for (const surface of SURFACE_STYLES) {
      const p = generatePalette({ ...DEFAULT_ANCHORS, surface }, "light");
      expect(rgbToHsl(hexToRgb(p.page)).l).toBeLessThan(rgbToHsl(hexToRgb(p.surface)).l);
    }
  });
});

describe("generateTheme", () => {
  it("liefert beide Modi auf einmal und beide bestehen die Prüfung", () => {
    const theme = generateTheme(DEFAULT_ANCHORS);
    expect(auditPalette(theme.light).every((r) => r.ok)).toBe(true);
    expect(auditPalette(theme.dark).every((r) => r.ok)).toBe(true);
    expect(theme.light).not.toEqual(theme.dark);
  });
});
