import { describe, expect, it } from "vitest";
import { paletteDeclarations, paletteToStyle, ringFrom, tenantThemeCss } from "./css";
import { DEFAULT_ANCHORS, generateTheme } from "./generate";
import { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./tokens";
import type { TenantBranding } from "@/lib/tenant/types";

const branding: TenantBranding = {
  logoUrl: null,
  colorPrimary: "#e11d48",
  colorAccent: "#f59e0b",
  colorPrimaryFg: "#ffffff",
};

const theme = { anchors: DEFAULT_ANCHORS, ...generateTheme(DEFAULT_ANCHORS) };

describe("tenantThemeCss — Kaskade", () => {
  it("legt alle drei Blöcke an: hell, Systemvorliebe dunkel, erzwungen dunkel", () => {
    const css = tenantThemeCss(branding, theme);
    expect(css).toContain(":root:root{");
    expect(css).toContain('@media (prefers-color-scheme:dark){:root:root:not([data-theme="light"]){');
    expect(css).toContain(':root:root[data-theme="dark"]{');
  });

  it("stellt erzwungenes Dunkel HINTER den Media-Block", () => {
    // Beide haben dieselbe Spezifität; bei Gleichstand entscheidet die
    // Reihenfolge. Stünde es davor, käme man aus dem Systemdunkel nicht
    // per Umschalter ins Helle zurück.
    const css = tenantThemeCss(branding, theme);
    expect(css.indexOf(':root:root[data-theme="dark"]{')).toBeGreaterThan(
      css.indexOf("@media (prefers-color-scheme:dark)"),
    );
  });

  it("gibt Hell und Dunkel wirklich getrennt aus", () => {
    const css = tenantThemeCss(branding, theme);
    const light = css.slice(0, css.indexOf("@media"));
    expect(light).toContain(`--page:${theme.light.page};`);
    expect(light).not.toContain(`--page:${theme.dark.page};`);
  });

  it("ohne eigene Farbwelt bleibt es beim bisherigen Verhalten: eine Marke für beide Modi", () => {
    const css = tenantThemeCss(branding, null);
    expect(css).toContain("--brand-primary:#e11d48;");
    // In BEIDEN Blöcken derselbe Wert — genau das erzwang vorher der
    // Inline-Style auf <html>.
    expect(css.match(/--brand-primary:#e11d48;/g)).toHaveLength(3);
    // …und sonst nichts: Flächen/Text bleiben beim Standard-Theme.
    expect(css).not.toContain("--page:");
    expect(css).not.toContain("--ink:");
  });
});

describe("tenantThemeCss — Injektionsschutz", () => {
  it("lässt einen Nicht-Hex-Wert ganz weg, statt ihn zu maskieren", () => {
    const evil = {
      ...theme,
      light: { ...theme.light, ink: "red;}body{display:none}/*" as string },
    };
    const css = tenantThemeCss(branding, evil);
    expect(css).not.toContain("display:none");
    expect(css).not.toContain("--ink:red");
    // Der Token fehlt im HELLEN Block schlicht → dort gilt der Standard aus
    // globals.css. Der Dunkel-Block ist unberührt und behält sein --ink.
    const light = css.slice(0, css.indexOf("@media"));
    expect(light).not.toContain("--ink:");
    expect(css.slice(css.indexOf("@media"))).toContain(`--ink:${theme.dark.ink};`);
  });

  it("erzeugt niemals ein <, das den style-Block schließen könnte", () => {
    const evil = {
      ...theme,
      dark: { ...theme.dark, page: "</style><script>alert(1)</script>" as string },
    };
    const css = tenantThemeCss(branding, evil);
    expect(css).not.toContain("<");
  });

  it("hält auch bei kaputtem Branding die Struktur", () => {
    const css = tenantThemeCss({ ...branding, colorPrimary: "javascript:alert(1)" }, null);
    expect(css).not.toContain("javascript");
    expect(css).toContain("--brand-accent:#f59e0b;");
  });

  it("gibt leeren String aus, wenn nichts Gültiges übrig bleibt", () => {
    const css = tenantThemeCss(
      { logoUrl: null, colorPrimary: "x", colorAccent: "y", colorPrimaryFg: "z" },
      null,
    );
    expect(css).toBe("");
  });
});

describe("Fokusring", () => {
  it("wird aus der Marken-Farbe abgeleitet", () => {
    expect(ringFrom("#4f46e5")).toBe("rgba(79, 70, 229, 0.55)");
  });

  it("steht in jedem ausgegebenen Satz", () => {
    expect(paletteDeclarations(LIGHT_DEFAULTS)).toContain("--ring:rgba(");
    expect(paletteDeclarations(DARK_DEFAULTS)).toContain("--ring:rgba(");
  });
});

describe("paletteToStyle (Vorschau im Verwaltungsbereich)", () => {
  it("bildet dieselben Tokens als Style-Objekt ab", () => {
    const style = paletteToStyle(LIGHT_DEFAULTS);
    expect(style["--page"]).toBe(LIGHT_DEFAULTS.page);
    expect(style["--ring"]).toBe(ringFrom(LIGHT_DEFAULTS["brand-primary"]));
  });

  it("überspringt ungültige Werte, statt sie zu setzen", () => {
    expect(paletteToStyle({ ...LIGHT_DEFAULTS, ink: "red" })["--ink"]).toBeUndefined();
  });
});
