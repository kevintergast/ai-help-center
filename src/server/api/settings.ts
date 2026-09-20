import { isActionVariant, MAX_ACTION_LABEL } from "@/lib/content/action-buttons";
import { parseThemeInput } from "@/lib/theme/palette";
import { Hono } from "hono";
import { requireOwner, requireTeam } from "@/server/auth/guards";
import type { ApiDeps, ApiEnv } from "./context";

/**
 * INSTANZ-EINSTELLUNGEN:
 *
 *   PUT /api/v1/admin/settings/seo     { indexable: boolean }      — OWNER
 *   PUT /api/v1/admin/settings/support { email: string | null }    — admin
 *   PUT /api/v1/admin/settings/locale  { locale: "de" | "en" }     — OWNER
 *   PUT /api/v1/admin/settings/header-name    { show: boolean }   — admin
 *   PUT /api/v1/admin/settings/widget-on-site { on: boolean }     — admin
 *   PUT /api/v1/admin/settings/theme   { anchors, light, dark }   — admin
 *   DELETE /api/v1/admin/settings/theme                           — admin
 *
 * SEO-Opt-out (Migration 0013): `false` schaltet die Instanz auf noindex
 * (Meta-Tag auf jeder Seite, robots Disallow-all, leere Sitemap, raus aus dem
 * zentralen Sitemap-Index). OWNER-Gate, nicht admin: die öffentliche
 * Auffindbarkeit des gesamten Hilfezentrums ist eine Instanz-Entscheidung
 * wie Legal/Domain (Design h) — Content-Pflege bleibt davon unberührt.
 *
 * Support-E-Mail (Migration 0014): Ziel der Support-Ticket-Mails; admin-Gate
 * (operative Support-Konfiguration, keine Instanz-Grundsatzentscheidung).
 * `null`/"" entfernt die Adresse → Tickets nur noch in der Admin-Inbox.
 */

/** Pragmatische E-Mail-Plausibilität (ein @, keine Spaces, ≤254 — kein RFC-Parser). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function settingsAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.put("/seo", requireOwner, async (c) => {
    let indexable: unknown;
    try {
      indexable = ((await c.req.json()) as { indexable?: unknown }).indexable;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (typeof indexable !== "boolean") return c.json({ error: "invalid_indexable" }, 400);

    const settings = await deps.getSettingsDeps?.();
    if (!settings) return c.json({ error: "settings_unavailable" }, 503);

    await settings.setSeoIndexable(c.get("tenant").id, indexable);
    return c.json({ ok: true, indexable });
  });

  r.put("/support", requireTeam("admin"), async (c) => {
    let email: unknown;
    try {
      email = ((await c.req.json()) as { email?: unknown }).email;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    // null/"" = Adresse entfernen; sonst strikte Plausibilität + Kanonisierung.
    let value: string | null;
    if (email === null || email === "") {
      value = null;
    } else if (typeof email === "string" && email.trim().length <= 254 && EMAIL_RE.test(email.trim())) {
      value = email.trim().toLowerCase();
    } else {
      return c.json({ error: "invalid_email" }, 400);
    }

    const settings = await deps.getSettingsDeps?.();
    if (!settings) return c.json({ error: "settings_unavailable" }, 503);

    await settings.setSupportEmail(c.get("tenant").id, value);
    return c.json({ ok: true, email: value });
  });

  // Header-Name-Schalter (0025): Name neben dem Logo aus-/einblenden —
  // admin-Gate (reine Darstellung, kein Instanz-Grundsatz).
  r.put("/header-name", requireTeam("admin"), async (c) => {
    let show: unknown;
    try {
      show = ((await c.req.json()) as { show?: unknown }).show;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (typeof show !== "boolean") return c.json({ error: "invalid_show" }, 400);

    const settings = await deps.getSettingsDeps?.();
    if (!settings) return c.json({ error: "settings_unavailable" }, 503);

    await settings.setShowHeaderName(c.get("tenant").id, show);
    return c.json({ ok: true, show });
  });

  // Widget auf den EIGENEN öffentlichen Seiten (0028): admin-Gate wie
  // header-name. Kein Owner-Gate, obwohl Antworten Credits kosten — die
  // Kostenseite ist über Budget/Limits gedeckelt, und der Launcher ist eine
  // operative Darstellungsentscheidung (zweiter Einstieg neben der Suche).
  r.put("/widget-on-site", requireTeam("admin"), async (c) => {
    let on: unknown;
    try {
      on = ((await c.req.json()) as { on?: unknown }).on;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (typeof on !== "boolean") return c.json({ error: "invalid_on" }, 400);

    const settings = await deps.getSettingsDeps?.();
    if (!settings) return c.json({ error: "settings_unavailable" }, 503);

    await settings.setWidgetOnSite(c.get("tenant").id, on);
    return c.json({ ok: true, on });
  });

  /**
   * „ICH VERSTEHE ETWAS NICHT" (0040) ein-/ausschalten. `admin`, nicht
   * `owner`: Das ist eine Entscheidung darüber, wie Rückmeldungen
   * hereinkommen — nichts Grundsätzliches wie Sprache oder Indexierung.
   */
  r.put("/comprehension-mode", requireTeam("admin"), async (c) => {
    let on: unknown;
    try {
      on = ((await c.req.json()) as { on?: unknown }).on;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (typeof on !== "boolean") return c.json({ error: "invalid_on" }, 400);

    const settings = await deps.getSettingsDeps?.();
    if (!settings) return c.json({ error: "settings_unavailable" }, 503);

    await settings.setComprehensionMode(c.get("tenant").id, on);
    return c.json({ ok: true, on });
  });

  /**
   * ERSCHEINUNGSBILD DES WIDGETS (0041): Variante + Beschriftung. Die Symbole
   * laufen über den Branding-Upload (`/admin/branding/logo?variant=widget`)
   * und nicht hier — dort sitzen Typ-Allowlist, Magic-Bytes-Abgleich und
   * Größendeckel bereits.
   */
  r.put("/widget-appearance", requireTeam("admin"), async (c) => {
    let body: { variant?: unknown; label?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (!isActionVariant(body.variant)) return c.json({ error: "invalid_variant" }, 400);

    // Leer = Rückfall auf den i18n-Standard, nicht „leerer Knopf".
    const raw = typeof body.label === "string" ? body.label.trim() : "";
    if (raw.length > MAX_ACTION_LABEL) return c.json({ error: "label_too_long" }, 400);
    const label = raw.length > 0 ? raw : null;

    const settings = await deps.getSettingsDeps?.();
    if (!settings) return c.json({ error: "settings_unavailable" }, 503);

    await settings.setWidgetAppearance(c.get("tenant").id, body.variant, label);
    return c.json({ ok: true, variant: body.variant, label });
  });

  /**
   * EIGENE FARBWELT (0045) setzen. `admin`, nicht `owner`: Das ist dieselbe
   * Art Entscheidung wie das Branding daneben — Erscheinungsbild, nicht
   * Bestand der Instanz.
   *
   * Der Body enthält die Farbwelt VOLLSTÄNDIG (Anker + beide Modi, je 24
   * Tokens). Kein Teil-Update: Die Farbwelt ergibt nur als Ganzes Sinn, und
   * ein halb geschriebener Satz wäre auf jeder Kundenseite sofort sichtbar.
   * Jeder Wert muss `#rgb`/`#rrggbb` sein — was hier durchkäme, stünde
   * anschließend in einem <style>-Block (siehe lib/theme/css.ts).
   */
  r.put("/theme", requireTeam("admin"), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = parseThemeInput(body);
    if (!parsed.ok || !parsed.config) {
      return c.json({ error: parsed.error ?? "invalid_shape", token: parsed.token }, 400);
    }

    const settings = await deps.getSettingsDeps?.();
    if (!settings) return c.json({ error: "settings_unavailable" }, 503);

    await settings.setTheme(c.get("tenant").id, parsed.config);
    return c.json({ ok: true, theme: parsed.config });
  });

  /** Farbwelt entfernen → Standard-Theme + die drei Marken-Farben. */
  r.delete("/theme", requireTeam("admin"), async (c) => {
    const settings = await deps.getSettingsDeps?.();
    if (!settings) return c.json({ error: "settings_unavailable" }, 503);

    await settings.setTheme(c.get("tenant").id, null);
    return c.json({ ok: true, theme: null });
  });

  // Standardsprache der Instanz (Endnutzer-UI, Meta, Mails) — OWNER wie SEO:
  // eine Instanz-Grundsatzentscheidung, keine Content-Pflege.
  r.put("/locale", requireOwner, async (c) => {
    let locale: unknown;
    try {
      locale = ((await c.req.json()) as { locale?: unknown }).locale;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (locale !== "de" && locale !== "en") return c.json({ error: "invalid_locale" }, 400);

    const settings = await deps.getSettingsDeps?.();
    if (!settings) return c.json({ error: "settings_unavailable" }, 503);

    await settings.setDefaultLocale(c.get("tenant").id, locale);
    return c.json({ ok: true, locale });
  });

  return r;
}
