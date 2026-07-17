import { Hono } from "hono";
import { requireOwner, requireTeam } from "@/server/auth/guards";
import type { ApiDeps, ApiEnv } from "./context";

/**
 * INSTANZ-EINSTELLUNGEN:
 *
 *   PUT /api/v1/admin/settings/seo     { indexable: boolean }      — OWNER
 *   PUT /api/v1/admin/settings/support { email: string | null }    — admin
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

  return r;
}
