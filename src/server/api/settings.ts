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
