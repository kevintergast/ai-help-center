import { NEUTRAL_TONES, SURFACE_STYLES } from "@/lib/theme/generate";
import { composeTheme, themeWarnings } from "@/lib/theme/palette";
import { THEME_TOKEN_KEYS } from "@/lib/theme/tokens";
import { fail, ok, type McpTool } from "./types";
import { frozen } from "./guards";

/**
 * FARBWELT-WERKZEUGE (0045).
 *
 * ABLEITEN STATT AUFZÄHLEN — die eine Entscheidung, die hier alles prägt:
 * Die Admin-Oberfläche schickt alle 48 Werte, weil ihr Formular sie hat. Ein
 * Sprachmodell hat sie nicht. Bekäme es ein Werkzeug mit 48 Pflichtfeldern,
 * würde es sie erfinden — plausibel aussehende Hex-Werte, die niemand geprüft
 * hat, direkt auf einer Kundenseite. Deshalb nimmt `set_theme` die vier
 * Angaben des Generators und leitet beide Modi ab; wer eine bestimmte Farbe
 * braucht, nennt genau diesen einen Token.
 *
 * Die Antwort enthält IMMER beide vollständigen Paletten. Das Modell soll
 * sehen, was es angerichtet hat, ohne nachfragen zu müssen — und die
 * Beanstandungen stehen daneben, statt still zu verschwinden.
 *
 * Kein Bestätigungs-Token: Eine Farbwelt ist ersetzbar und verliert keine
 * Inhalte. `reset_theme` stellt den Standard wieder her, die Marken-Farben
 * der Instanz bleiben dabei erhalten.
 */

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
const PUBLIC_HINTS = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;

const FROZEN_RESULT = () =>
  fail(
    "plan_frozen",
    "This help center is frozen because of an overdue plan. Appearance changes are blocked until billing is settled.",
  );

/** Die Token-Liste steht in der Beschreibung, nicht als 24 Schema-Felder:
 *  So sieht das Modell, was es benennen KANN, ohne dass das Schema zum
 *  Ausfüllformular wird. */
const TOKEN_LIST = THEME_TOKEN_KEYS.join(", ");

const OVERRIDE_SCHEMA = {
  type: "object",
  description: `Optional. Only the tokens that must deviate from the derived palette, e.g. {"page": "#f4f5f7"}. Everything you omit is derived and stays within the contrast threshold. Allowed keys: ${TOKEN_LIST}. An unknown key is rejected rather than ignored.`,
  additionalProperties: { type: "string", description: "#rgb or #rrggbb" },
} as const;

export const getTheme: McpTool = {
  name: "get_theme",
  title: "Farbwelt lesen",
  description:
    "Read this help center's colour world: the four generator inputs plus the complete light and dark palettes. If the instance has no colour world of its own, `active` is false and the palettes show the defaults currently in effect (standard theme plus the instance's brand colour).",
  scope: "settings:read",
  annotations: READ_ONLY,
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const theme = ctx.tenant.theme ?? null;
    if (!theme) {
      return ok({
        active: false,
        note: "No colour world of its own. The standard theme applies, overridden by the instance's brand colours.",
        branding: ctx.tenant.branding,
      });
    }
    return ok({
      active: true,
      anchors: theme.anchors,
      light: theme.light,
      dark: theme.dark,
      warnings: themeWarnings(theme),
    });
  },
};

export const setTheme: McpTool = {
  name: "set_theme",
  title: "Farbwelt setzen",
  description:
    "Set the help center's colours for light AND dark mode. Give the four generator inputs; both palettes are derived from them, and the derivation keeps text contrast at 4.5:1 — you do NOT list 48 colour values, and you should not try to. If a specific token must deviate (because a design system prescribes it), name that one token under `light` or `dark`. The response returns both complete palettes plus any contrast warnings your overrides caused; warnings do not block the save. Visible to end users on the next page load. Brand and accent colour of the light palette also become the instance's brand identity (used by the embeddable widget, which does not know the visitor's mode).",
  scope: "settings:write",
  annotations: PUBLIC_HINTS,
  inputSchema: {
    type: "object",
    properties: {
      brand: { type: "string", description: "Brand colour, #rgb or #rrggbb. Buttons, links, highlights." },
      accent: { type: "string", description: "Secondary colour for accents, #rgb or #rrggbb." },
      neutral: {
        type: "string",
        enum: [...NEUTRAL_TONES],
        description: "Temperature of the greys that carry the whole interface.",
      },
      surface: {
        type: "string",
        enum: [...SURFACE_STYLES],
        description: "plain = neutral surfaces; tinted = surfaces slightly tinted in the neutral temperature.",
      },
      light: OVERRIDE_SCHEMA,
      dark: OVERRIDE_SCHEMA,
    },
    required: ["brand", "accent", "neutral", "surface"],
  },
  async handler(args, ctx) {
    const composed = composeTheme(args);
    if (!composed.ok || !composed.config) {
      const where = composed.token ? ` (\`${composed.token}\`)` : "";
      if (composed.error === "unknown_token") {
        return fail(
          "unknown_token",
          `Unknown colour token${where}. Allowed keys: ${TOKEN_LIST}. Use the bare name, without the leading "--".`,
        );
      }
      if (composed.error === "invalid_anchors") {
        return fail(
          "invalid_anchors",
          `\`brand\` and \`accent\` must be #rgb or #rrggbb, \`neutral\` one of ${NEUTRAL_TONES.join(", ")}, \`surface\` one of ${SURFACE_STYLES.join(", ")}${where}.`,
        );
      }
      return fail("invalid_color", `Every colour must be #rgb or #rrggbb${where}.`);
    }

    const settings = await ctx.deps.getSettingsDeps?.();
    if (!settings) return fail("settings_unavailable", "Settings storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    await settings.setTheme(ctx.tenant.id, composed.config);

    const warnings = themeWarnings(composed.config);
    return ok({
      anchors: composed.config.anchors,
      light: composed.config.light,
      dark: composed.config.dark,
      warnings,
      note:
        warnings.length === 0
          ? "Saved. Every checked pair meets its threshold."
          : "Saved, but some pairs are below their threshold — these come from your overrides, not from the derivation. Drop the override to get a checked value back.",
    });
  },
};

export const resetTheme: McpTool = {
  name: "reset_theme",
  title: "Farbwelt zurücksetzen",
  description:
    "Remove this help center's own colour world. The standard theme applies again, overridden by the instance's brand and accent colour — those are NOT deleted, they are the fallback. No article or setting is affected.",
  scope: "settings:write",
  annotations: PUBLIC_HINTS,
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const settings = await ctx.deps.getSettingsDeps?.();
    if (!settings) return fail("settings_unavailable", "Settings storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    await settings.setTheme(ctx.tenant.id, null);
    return ok({
      active: false,
      branding: ctx.tenant.branding,
      note: "Colour world removed. The standard theme applies, overridden by the brand colours.",
    });
  },
};

export const THEME_TOOLS: McpTool[] = [getTheme, setTheme, resetTheme];
