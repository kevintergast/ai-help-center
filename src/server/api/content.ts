import type { Context } from "hono";
import { Hono } from "hono";
import { requireTeam } from "@/server/auth/guards";
import { SlugConflictError } from "@/server/content/store";
import { parseCreateArticle, parseUpdateArticle } from "@/server/content/validate";
import type { ApiDeps, ApiEnv, GuardSessionData } from "./context";

/**
 * CONTENT-ADMIN-API — Pflege der Hilfe-Artikel (`/admin/articles*`).
 *
 *   - POST   /admin/articles           — Artikel anlegen (Status: draft; Slug-Dublette → 409)
 *   - PUT    /admin/articles/:id        — Artikel aktualisieren (+ Version-Snapshot)
 *   - POST   /admin/articles/:id/publish   — veröffentlichen (sichtbar + Snapshot)
 *   - POST   /admin/articles/:id/unpublish — zurück auf draft (aus dem Public-Read nehmen)
 *   - DELETE /admin/articles/:id        — löschen (inkl. Versionen)
 *
 * GATING: alle Routen `requireTeam("content")` — Content-Verantwortliche und höher
 * (admin/owner erben über die lineare Rangordnung). TENANT-SCOPE: ausschließlich
 * `c.get("tenant").id` (aus der Host-Auflösung) — NIE aus Param/Body.
 *
 * LIFECYCLE-REGEL (hart): nur `status='published'` erscheint öffentlich (und ist
 * später RAG-fähig). Ein Draft ist nirgends im Hilfezentrum sichtbar.
 *
 * SICHERHEIT: `body` wird als DATEN gespeichert (JSON string[]) — kein
 * serverseitiges HTML-Rendering ⇒ kein XSS auf API-Ebene (sicheres Rendern ist
 * UI-Sache). Fehlercodes sind stabile, maschinenlesbare englische Strings.
 *
 * Persistenz über `deps.getContentDeps()` (D1 der Request-Runtime); ohne Binding
 * → 503 fail-closed.
 */

/** Aktuelle User-ID (für Snapshot-Autor) — best effort, blockiert nie. */
async function actorId(c: Context<ApiEnv>): Promise<string | null> {
  try {
    const auth = await c.get("getAuth")();
    const data = (await auth.api.getSession({
      headers: c.req.raw.headers,
    })) as (GuardSessionData & { user?: { id?: string } }) | null;
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function readJson(c: Context<ApiEnv>): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

export function contentAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  // Anlegen (Status: draft). Erst nach POST /:id/publish öffentlich sichtbar.
  r.post("/", requireTeam("content"), async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);

    const result = parseCreateArticle(parsed.body, c.get("tenant").defaultLocale);
    if (!result.ok) return c.json({ error: result.error }, result.status);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    try {
      const id = await content.store.create(c.get("tenant").id, result.value);
      return c.json({ ok: true, id }, 201);
    } catch (err) {
      // Slug bereits vergeben (je tenant/locale eindeutig) → client-korrigierbar.
      if (err instanceof SlugConflictError) return c.json({ error: "slug_conflict" }, 409);
      throw err;
    }
  });

  // Aktualisieren (Teil-Update; erzeugt einen Version-Snapshot).
  r.put("/:id", requireTeam("content"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);

    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);

    const result = parseUpdateArticle(parsed.body);
    if (!result.ok) return c.json({ error: result.error }, result.status);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const ok = await content.store.update(c.get("tenant").id, id, result.value, await actorId(c));
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  r.post("/:id/publish", requireTeam("content"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const ok = await content.store.publish(c.get("tenant").id, id, await actorId(c));
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, status: "published" });
  });

  r.post("/:id/unpublish", requireTeam("content"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const ok = await content.store.unpublish(c.get("tenant").id, id);
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, status: "draft" });
  });

  r.delete("/:id", requireTeam("content"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const ok = await content.store.remove(c.get("tenant").id, id);
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return r;
}
