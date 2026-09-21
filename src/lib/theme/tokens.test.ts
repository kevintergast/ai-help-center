import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DARK_DEFAULTS, LIGHT_DEFAULTS, THEME_TOKENS, THEME_TOKEN_KEYS } from "./tokens";
import { isHexColor } from "./color";

/**
 * DRIFT-SCHUTZ. Die Standardfarben stehen zweimal: in globals.css (dort gelten
 * sie) und hier (dort rechnet der Generator mit ihnen). CSS lässt sich nicht
 * nach TypeScript importieren, also prüfen wir die Kopie gegen das Original.
 *
 * Schlägt dieser Test fehl, ist meist globals.css geändert worden, ohne
 * tokens.ts nachzuziehen — dann zeigt die Vorschau im Verwaltungsbereich
 * etwas anderes als das echte Hilfezentrum.
 */

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

function block(selector: RegExp): Record<string, string> {
  const match = selector.exec(css);
  if (!match) throw new Error(`Block nicht gefunden: ${selector}`);
  const from = css.indexOf("{", match.index) + 1;
  const to = css.indexOf("}", from);
  const out: Record<string, string> = {};
  for (const decl of css.slice(from, to).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[decl[1]] = decl[2].trim();
  }
  return out;
}

describe("Token-Verzeichnis", () => {
  it("führt jeden Token genau einmal", () => {
    expect(new Set(THEME_TOKEN_KEYS).size).toBe(THEME_TOKENS.length);
  });

  it("belegt beide Standard-Sätze lückenlos mit gültigem Hex", () => {
    for (const key of THEME_TOKEN_KEYS) {
      expect(isHexColor(LIGHT_DEFAULTS[key]), `light/${key}`).toBe(true);
      expect(isHexColor(DARK_DEFAULTS[key]), `dark/${key}`).toBe(true);
    }
  });
});

describe("Spiegelung von globals.css", () => {
  it("der helle Standard entspricht dem :root-Block", () => {
    const root = block(/^:root \{/m);
    for (const key of THEME_TOKEN_KEYS) {
      expect(root[key], `--${key}`).toBe(LIGHT_DEFAULTS[key]);
    }
  });

  it("der dunkle Standard entspricht dem erzwungenen Dunkel-Block", () => {
    const forced = block(/^:root\[data-theme="dark"\] \{/m);
    for (const key of THEME_TOKEN_KEYS) {
      expect(forced[key], `--${key}`).toBe(DARK_DEFAULTS[key]);
    }
  });

  it("die beiden Dunkel-Blöcke in globals.css sind identisch", () => {
    // Sie stehen doppelt, weil CSS keine Block-Wiederverwendung kennt — genau
    // deshalb laufen sie auseinander, wenn nur einer gepflegt wird.
    const media = block(/:root:root:not\(\[data-theme="light"\]\) \{|:root:not\(\[data-theme="light"\]\) \{/);
    const forced = block(/^:root\[data-theme="dark"\] \{/m);
    for (const key of THEME_TOKEN_KEYS) {
      expect(media[key], `--${key}`).toBe(forced[key]);
    }
  });
});
