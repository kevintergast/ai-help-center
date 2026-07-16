import { Hono } from "hono";
import { requireOwner } from "@/server/auth/guards";
import type { ApiDeps, ApiEnv } from "./context";

/**
 * INSTANZ-EINSTELLUNGEN (owner-only) — aktuell genau eine:
 *
 *   PUT /api/v1/admin/settings/seo { indexable: boolean }
 *
 * SEO-Opt-out (Migration 0013): `false` schaltet die Instanz auf noindex
 * (Meta-Tag auf jeder Seite, robots Disallow-all, leere Sitemap, raus aus dem
 * zentralen Sitemap-Index). OWNER-Gate, nicht admin: die öffentliche
 * Auffindbarkeit des gesamten Hilfezentrums ist eine Instanz-Entscheidung
 * wie Legal/Domain (Design h) — Content-Pflege bleibt davon unberührt.
 */
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

  return r;
}
