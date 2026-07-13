import { describe, expect, it } from "vitest";
import { isHexColor, parseBrandingColors, sniffImageType } from "./validate";

describe("isHexColor (strikte Hex-Allowlist)", () => {
  it("akzeptiert #rgb und #rrggbb, case-insensitive", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#4F46E5")).toBe(true);
    expect(isHexColor("#4f46e5")).toBe(true);
  });

  it("lehnt alles ab, was keine strikte Hex-Farbe ist (inkl. CSS-Injection-Versuche)", () => {
    for (const bad of [
      "fff", // ohne #
      "#ffff", // 4 Stellen
      "#12345", // 5 Stellen
      "#1234567", // 7 Stellen
      "#ggg", // keine Hex-Zeichen
      "red", // Keyword
      "rgb(0,0,0)",
      "var(--x)",
      "#fff;", // Trailing-Injection
      "red;}body{background:url(https://evil.example/x)}", // CSS-Injection
      "#fff}html{display:none", // Block-Breakout
      " #fff", // Whitespace
      "#fff ",
      "",
      null,
      undefined,
      123,
      { toString: () => "#fff" }, // kein echter String
    ]) {
      expect(isHexColor(bad), String(bad)).toBe(false);
    }
  });
});

describe("parseBrandingColors", () => {
  it("liefert exakt die drei validierten Farben", () => {
    expect(
      parseBrandingColors({
        colorPrimary: "#4f46e5",
        colorAccent: "#06B6D4",
        colorPrimaryFg: "#fff",
        extra: "wird ignoriert",
      }),
    ).toEqual({ colorPrimary: "#4f46e5", colorAccent: "#06B6D4", colorPrimaryFg: "#fff" });
  });

  it("null bei fehlendem Feld, Nicht-Objekt oder einer einzigen ungültigen Farbe", () => {
    expect(parseBrandingColors(null)).toBeNull();
    expect(parseBrandingColors("string")).toBeNull();
    expect(parseBrandingColors({ colorPrimary: "#fff", colorAccent: "#fff" })).toBeNull();
    expect(
      parseBrandingColors({ colorPrimary: "#fff", colorAccent: "#fff", colorPrimaryFg: "red" }),
    ).toBeNull();
  });
});

describe("sniffImageType (Magic Bytes)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);

  it("erkennt PNG, JPEG und WebP", () => {
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  it("null für SVG/Text/zu kurze Buffer — Client-Content-Type zählt nicht", () => {
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("GIF89a------"))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
    // RIFF ohne WEBP-Kennung (z. B. WAV) ist KEIN WebP:
    expect(
      sniffImageType(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]),
      ),
    ).toBeNull();
  });
});
