import { describe, expect, it } from "vitest";
import {
  blackOrWhite,
  contrastRatio,
  ensureContrast,
  isHexColor,
  mix,
  normalizeHex,
  rgbToHsl,
  hexToRgb,
  hslToRgb,
  rgbToHex,
} from "./color";

describe("isHexColor / normalizeHex", () => {
  it("nimmt #rgb und #rrggbb und kanonisiert auf lange Kleinschreibung", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("#A1B2C3")).toBe("#a1b2c3");
  });

  it("weist alles zurück, was CSS-Struktur werden könnte", () => {
    // Das ist die Sicherheitsgrenze: Was hier durchkäme, stünde in einem
    // <style>-Block. Nur Hex, nichts sonst.
    for (const bad of [
      "red",
      "rgb(1,2,3)",
      "#ffff",
      "#12345",
      "#1234567",
      "#fff;}body{display:none",
      "var(--ink)",
      " #fff",
      "#ff f",
      "",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isHexColor(bad), String(bad)).toBe(false);
      expect(normalizeHex(bad), String(bad)).toBeNull();
    }
  });
});

describe("contrastRatio", () => {
  it("liefert die bekannten Eckwerte", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("ist symmetrisch", () => {
    expect(contrastRatio("#4f46e5", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#4f46e5"), 10);
  });

  it("stimmt mit einem von Hand geprüften Wert überein", () => {
    // #767676 auf Weiß ist der klassische AA-Grenzfall (4.54:1).
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
  });
});

describe("HSL-Umrechnung", () => {
  it("ist verlustfrei genug für Hin- und Rückweg", () => {
    for (const hex of ["#4f46e5", "#06b6d4", "#e11d48", "#16181d", "#f4f5f7", "#808080"]) {
      expect(rgbToHex(hslToRgb(rgbToHsl(hexToRgb(hex))))).toBe(hex);
    }
  });
});

describe("ensureContrast", () => {
  it("lässt in Ruhe, was schon reicht", () => {
    expect(ensureContrast("#16181d", "#ffffff", 4.5)).toBe("#16181d");
  });

  it("dunkelt auf hellem Grund ab, bis die Schwelle erreicht ist", () => {
    const out = ensureContrast("#9ad1ff", "#ffffff", 4.5);
    expect(contrastRatio(out, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("hellt auf dunklem Grund auf", () => {
    const out = ensureContrast("#1a237e", "#0b0d11", 4.5);
    expect(contrastRatio(out, "#0b0d11")).toBeGreaterThanOrEqual(4.5);
  });

  it("hält den Farbton, statt auf Grau auszuweichen", () => {
    const before = rgbToHsl(hexToRgb("#9ad1ff"));
    const after = rgbToHsl(hexToRgb(ensureContrast("#9ad1ff", "#ffffff", 4.5)));
    expect(Math.abs(after.h - before.h)).toBeLessThan(2);
  });

  it("fällt auf Schwarz/Weiß zurück, wenn keine Helligkeit reicht", () => {
    // Auf mittlerem Grau erreicht ein gesättigtes Gelb 7:1 in keiner Helligkeit.
    const out = ensureContrast("#ffe600", "#808080", 7);
    expect(["#000000", "#ffffff"]).toContain(out);
  });
});

describe("blackOrWhite / mix", () => {
  it("wählt die lesbarere Schrift", () => {
    expect(blackOrWhite("#ffffff")).toBe("#000000");
    expect(blackOrWhite("#000000")).toBe("#ffffff");
  });

  it("mischt an den Enden exakt", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});
