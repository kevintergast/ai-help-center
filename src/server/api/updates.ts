import { Hono } from "hono";
import { requireTeam } from "@/server/auth/guards";
import { validateChangelogInput, validateRoadmapInput } from "@/server/content/updates";
import type { ApiDeps, ApiEnv } from "./context";

/**
 * PRODUKT-UPDATES pflegen (Changelog + Roadmap) — vorher gab es diese Inhalte
 * nur per Seed-Skript, Kunden konnten sie gar nicht pflegen.
 *
 *   GET/POST        /api/v1/admin/changelog          — Liste / anlegen
 *   PUT/DELETE      /api/v1/admin/changelog/:id      — ändern / löschen
 *   GET/POST        /api/v1/admin/roadmap            — Liste / anlegen
 *   PUT/DELETE      /api/v1/admin/roadmap/:id        — ändern / löschen
 *
 * GATE: `content` — das ist Inhaltspflege, keine Instanz-Grundsatzentscheidung.
 *
 * WICHTIG: Changelog-Einträge sind SOFORT öffentlich (es gibt keinen Entwurf —
 * `published_at` ist das Anzeigedatum). Das ist bewusst so: ein Changelog ist
 * eine Mitteilung, kein Artikel mit Lebenszyklus. Wer vorbereiten will, setzt
 * `publishedAt` in die Zukunft — die Liste sortiert danach.
 *
 * Jede Änderung zieht den Such-Index nach (Changelog/Roadmap sind Pseudo-
 * Dokumente im RAG, s. search/aux-docs.ts) — sonst antwortet die KI mit
 * Ständen, die es nicht mehr gibt.
 */
export function updatesAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  /**
   * Index-Nachzug nach jeder Mutation. Changelog/Roadmap sind PSEUDO-Dokumente
   * ohne Lifecycle-Hook (search/aux-docs.ts) — ihr Sync-Weg ist der Rebuild.
   * Der ist hash-basiert, unveränderte Chunks kosten also nichts. Best effort:
   * ein Index-Ausfall darf die fachliche Änderung nicht kippen.
   */
  async function reindex(tenantId: string): Promise<void> {
    try {
      const indexer = await deps.getContentIndexer?.();
      await indexer?.rebuildTenant(tenantId);
    } catch (err) {
      console.error("[updates] Reindex fehlgeschlagen:", err);
    }
  }

  // ——— Changelog ———

  r.get("/changelog", requireTeam("content"), async (c) => {
    const store = await deps.getUpdatesStore?.();
    if (!store) return c.json({ error: "content_unavailable" }, 503);
    return c.json({ entries: await store.listChangelog(c.get("tenant").id) });
  });

  r.post("/changelog", requireTeam("content"), async (c) => {
    const store = await deps.getUpdatesStore?.();
    if (!store) return c.json({ error: "content_unavailable" }, 503);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = validateChangelogInput(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const tenantId = c.get("tenant").id;
    const entry = await store.createChangelog(tenantId, parsed.value, Math.floor(Date.now() / 1000));
    await reindex(tenantId);
    return c.json({ ok: true, entry }, 201);
  });

  r.put("/changelog/:id", requireTeam("content"), async (c) => {
    const store = await deps.getUpdatesStore?.();
    if (!store) return c.json({ error: "content_unavailable" }, 503);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = validateChangelogInput(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);
    const tenantId = c.get("tenant").id;
    const entry = await store.updateChangelog(tenantId, id, parsed.value);
    if (!entry) return c.json({ error: "not_found" }, 404);
    await reindex(tenantId);
    return c.json({ ok: true, entry });
  });

  r.delete("/changelog/:id", requireTeam("content"), async (c) => {
    const store = await deps.getUpdatesStore?.();
    if (!store) return c.json({ error: "content_unavailable" }, 503);

    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);
    const tenantId = c.get("tenant").id;
    const removed = await store.deleteChangelog(tenantId, id);
    if (!removed) return c.json({ error: "not_found" }, 404);
    await reindex(tenantId);
    return c.json({ ok: true });
  });

  // ——— Roadmap ———

  r.get("/roadmap", requireTeam("content"), async (c) => {
    const store = await deps.getUpdatesStore?.();
    if (!store) return c.json({ error: "content_unavailable" }, 503);
    return c.json({ items: await store.listRoadmap(c.get("tenant").id) });
  });

  r.post("/roadmap", requireTeam("content"), async (c) => {
    const store = await deps.getUpdatesStore?.();
    if (!store) return c.json({ error: "content_unavailable" }, 503);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = validateRoadmapInput(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const tenantId = c.get("tenant").id;
    const item = await store.createRoadmap(tenantId, parsed.value);
    await reindex(tenantId);
    return c.json({ ok: true, item }, 201);
  });

  r.put("/roadmap/:id", requireTeam("content"), async (c) => {
    const store = await deps.getUpdatesStore?.();
    if (!store) return c.json({ error: "content_unavailable" }, 503);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = validateRoadmapInput(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);
    const tenantId = c.get("tenant").id;
    const item = await store.updateRoadmap(tenantId, id, parsed.value);
    if (!item) return c.json({ error: "not_found" }, 404);
    await reindex(tenantId);
    return c.json({ ok: true, item });
  });

  r.delete("/roadmap/:id", requireTeam("content"), async (c) => {
    const store = await deps.getUpdatesStore?.();
    if (!store) return c.json({ error: "content_unavailable" }, 503);

    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);
    const tenantId = c.get("tenant").id;
    const removed = await store.deleteRoadmap(tenantId, id);
    if (!removed) return c.json({ error: "not_found" }, 404);
    await reindex(tenantId);
    return c.json({ ok: true });
  });

  return r;
}
