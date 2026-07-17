import type { Context } from "hono";
import { Hono } from "hono";
import { requireOwner, requireTeam } from "@/server/auth/guards";
import { sniffImageType } from "@/server/branding/validate";
import {
  articleImageKey,
  MAX_IMAGES_PER_ARTICLE,
  SlugConflictError,
} from "@/server/content/store";
import {
  articleToMarkdown,
  buildExportFile,
  parseImportFile,
  parseMarkdownArticle,
  type RawImportArticle,
} from "@/server/content/transfer";
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

/** Datei-/Beschreibungs-Limits der Artikel-Bilder (Upload-Route). */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB (Logo: 1 MB; Inhaltsbilder größer)
const MAX_IMAGE_DESCRIPTION_CHARS = 500;

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

  // Such-/RAG-Index dem Lifecycle hinterherziehen (Infra-Plan Schritt 6).
  // BEST-EFFORT: Indexierung blockiert nie eine Content-Operation und läuft
  // asynchron weiter (waitUntil in der Runtime-Impl); ohne Bindings No-op.
  const syncIndex = async (tenantId: string, articleId: string) => {
    try {
      const indexer = await deps.getContentIndexer?.();
      await indexer?.onContentChange(tenantId, articleId);
    } catch (err) {
      console.error("[search-index] sync fehlgeschlagen:", err);
    }
  };

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
    await syncIndex(c.get("tenant").id, id);
    return c.json({ ok: true });
  });

  r.post("/:id/publish", requireTeam("content"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const ok = await content.store.publish(c.get("tenant").id, id, await actorId(c));
    if (!ok) return c.json({ error: "not_found" }, 404);
    await syncIndex(c.get("tenant").id, id);
    return c.json({ ok: true, status: "published" });
  });

  r.post("/:id/unpublish", requireTeam("content"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const ok = await content.store.unpublish(c.get("tenant").id, id);
    if (!ok) return c.json({ error: "not_found" }, 404);
    await syncIndex(c.get("tenant").id, id);
    return c.json({ ok: true, status: "draft" });
  });

  // Kompletter Index-Neuaufbau (Backfill nach Deploy/Fehler). Owner-exklusiv —
  // embedded jeden veröffentlichten Artikel neu, dessen Chunks sich geändert
  // haben (unveränderte kosten dank Hash-Vergleich nichts).
  r.post("/reindex", requireOwner, async (c) => {
    const indexer = await deps.getContentIndexer?.();
    if (!indexer) return c.json({ error: "search_index_unavailable" }, 503);
    const result = await indexer.rebuildTenant(c.get("tenant").id);
    return c.json({ ok: true, ...result });
  });

  // ——— ÜBERSETZUNGEN (Translation-Sets; KI-Modus = bezahltes Feature) ———

  /** Sprachfassungen des Sets (Editor-Sektion „Übersetzungen"). */
  r.get("/:id/translations", requireTeam("content"), async (c) => {
    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const tenant = c.get("tenant");
    const source = await content.store.getForEdit(tenant.id, c.req.param("id") ?? "", tenant.defaultLocale);
    if (!source) return c.json({ error: "not_found" }, 404);

    const members = await content.store.listTranslations(
      tenant.id,
      source.articleKey ?? source.id,
    );
    return c.json({ members });
  });

  /**
   * Übersetzung anlegen: `{ locale, mode: "manual" | "ai" }`.
   *  - manual: kopiert Titel/Blöcke als Startpunkt (Draft, Slug `<slug>-<locale>`).
   *  - ai: KI übersetzt Titel + Blöcke + Bild-Beschreibungen; Bilder werden
   *    in R2 mitkopiert (eigene Keys der neuen Zeile). Verbucht `ai_translation`
   *    Credits erst NACH Erfolg — Fehlschläge kosten nichts (502).
   * Beide: neue Zeile teilt den article_key (Set), startet als DRAFT.
   */
  r.post("/:id/translations", requireTeam("content"), async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);
    const body = parsed.body as { locale?: unknown; mode?: unknown };
    const targetLocale = body.locale;
    const mode = body.mode === "ai" ? "ai" : body.mode === "manual" ? "manual" : null;
    if ((targetLocale !== "de" && targetLocale !== "en") || mode === null) {
      return c.json({ error: "invalid_translation_request" }, 400);
    }

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);
    const tenant = c.get("tenant");

    const source = await content.store.getForEdit(tenant.id, c.req.param("id") ?? "", tenant.defaultLocale);
    if (!source) return c.json({ error: "not_found" }, 404);
    const articleKey = source.articleKey ?? source.id;
    if ((source.locale ?? tenant.defaultLocale) === targetLocale) {
      return c.json({ error: "same_locale" }, 400);
    }
    const members = await content.store.listTranslations(tenant.id, articleKey);
    if (members.some((m) => m.locale === targetLocale)) {
      return c.json({ error: "translation_exists" }, 409);
    }

    // Inhalte bestimmen (manual = Kopie als Startpunkt; ai = Übersetzung).
    let title = source.title;
    let blocks = source.body;
    let imageDescriptions = (source.images ?? []).map((i) => i.description);
    if (mode === "ai") {
      const translator = await deps.getTranslator?.();
      if (!translator) return c.json({ error: "translator_unavailable" }, 503);
      try {
        const result = await translator({
          sourceLocale: source.locale ?? tenant.defaultLocale,
          targetLocale,
          title: source.title,
          body: source.body,
          imageDescriptions,
        });
        title = result.title;
        blocks = result.body;
        imageDescriptions = result.imageDescriptions;
      } catch (err) {
        // Format-/Modellfehler: nichts angelegt, NICHTS verbucht.
        console.error("[translate] fehlgeschlagen:", err);
        return c.json({ error: "translation_failed" }, 502);
      }
    }

    const slug = `${source.slug}-${targetLocale}`.slice(0, 128);
    let newId: string;
    try {
      newId = await content.store.create(
        tenant.id,
        {
          slug,
          title,
          category: source.category,
          locale: targetLocale,
          body: blocks,
          videos: source.videos,
          relatedIds: source.relatedIds,
          readingMinutes: source.readingMinutes,
          isAiGenerated: mode === "ai",
        },
        articleKey,
      );
    } catch (err) {
      if (err instanceof SlugConflictError) return c.json({ error: "slug_conflict" }, 409);
      throw err;
    }

    // Bilder mitnehmen: R2-Kopie unter den Keys der NEUEN Zeile, Beschreibung
    // ggf. übersetzt. Best effort je Bild — ein Kopierfehler bricht die
    // Übersetzung nicht ab (Bild fehlt dann sichtbar im Editor).
    const sourceImages = source.images ?? [];
    if (content.media && sourceImages.length > 0) {
      for (const [index, img] of sourceImages.entries()) {
        try {
          const obj = await content.media.get(articleImageKey(tenant.id, source.id, img.id));
          if (!obj) continue;
          const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
          const copy = { id: crypto.randomUUID(), description: imageDescriptions[index] ?? img.description };
          await content.media.put(articleImageKey(tenant.id, newId, copy.id), bytes, {
            httpMetadata: { contentType: obj.httpMetadata?.contentType },
          });
          await content.store.addImage(tenant.id, newId, copy);
        } catch (err) {
          console.error("[translate] Bild-Kopie fehlgeschlagen:", err);
        }
      }
    }

    // Credits NUR für den KI-Modus, NACH Erfolg (Team zahlt Listenpreis —
    // bewusst bezahltes Feature, s. creditsFor).
    if (mode === "ai") {
      const billing = await deps.getBillingDeps?.();
      if (billing) {
        const userId = await actorId(c);
        await billing.repo.recordAiTranslation({
          tenantId: tenant.id,
          actorType: "internal",
          visitorId: userId ? `u:${userId}` : "u:unknown",
          userId,
          articleId: newId,
          nowSec: Math.floor(Date.now() / 1000),
        });
      }
    }

    return c.json({ ok: true, id: newId, slug, locale: targetLocale }, 201);
  });

  // ——— BILDER (Content-Werkzeuge R2; Beschreibung = Alt-Text + KI-Kontext) ——

  /**
   * Bild hochladen (multipart: `file` + `description`). Die BESCHREIBUNG ist
   * PFLICHT (Architektur: a11y-Alt-Text UND KI-Kontext in einem — sie fließt
   * als eigener Absatz in die Such-Chunks). Datei-Validierung wie beim Logo:
   * Magic-Bytes (PNG/JPEG/WebP), Größen-Limit; der R2-Key wird aus den Ids
   * ABGELEITET — nie aus Client-Input.
   */
  r.post("/:id/images", requireTeam("content"), async (c) => {
    const articleId = c.req.param("id");
    if (!articleId) return c.json({ error: "not_found" }, 404);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);
    if (!content.media) return c.json({ error: "media_unavailable" }, 503);

    let form: Record<string, unknown>;
    try {
      form = await c.req.parseBody();
    } catch {
      return c.json({ error: "invalid_form" }, 400);
    }

    const file = form.file;
    if (!(file instanceof File)) return c.json({ error: "image_file_required" }, 400);
    if (file.size > MAX_IMAGE_BYTES) return c.json({ error: "image_too_large" }, 413);

    const description = typeof form.description === "string" ? form.description.trim() : "";
    if (description.length === 0) return c.json({ error: "image_description_required" }, 400);
    if (description.length > MAX_IMAGE_DESCRIPTION_CHARS) {
      return c.json({ error: "image_description_too_long" }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffImageType(bytes);
    if (!sniffed) return c.json({ error: "unsupported_image_type" }, 415);

    const image = { id: crypto.randomUUID(), description };
    const tenantId = c.get("tenant").id;

    // Erst R2 (Binärdatei), dann Metadaten — schlägt der zweite Schritt fehl,
    // bleibt schlimmstenfalls ein unreferenziertes Objekt (nie ein Bild ohne
    // Datei). Aufräumen bei "not_found"/"limit" direkt wieder.
    await content.media.put(articleImageKey(tenantId, articleId, image.id), bytes, {
      httpMetadata: { contentType: sniffed },
    });
    const result = await content.store.addImage(tenantId, articleId, image);
    if (result !== "ok") {
      await content.media.delete(articleImageKey(tenantId, articleId, image.id));
      if (result === "limit") return c.json({ error: "too_many_images" }, 409);
      return c.json({ error: "not_found" }, 404);
    }

    // Beschreibung ist KI-Kontext → Index nachziehen (published-Check im Sync).
    await syncIndex(tenantId, articleId);
    return c.json({ ok: true, image }, 201);
  });

  /**
   * Bild-Vorschau für den EDITOR (auch Drafts — public serviert ausschließlich
   * published, s. contentImagesPublicRouter). Team-gegated, tenant-scoped.
   */
  r.get("/:id/images/:imageId", requireTeam("content"), async (c) => {
    const content = await deps.getContentDeps();
    if (!content?.media) return c.json({ error: "media_unavailable" }, 503);

    const articleId = c.req.param("id");
    const imageId = c.req.param("imageId");
    if (!articleId || !imageId) return c.json({ error: "not_found" }, 404);

    const tenantId = c.get("tenant").id;
    const obj = await content.media.get(articleImageKey(tenantId, articleId, imageId));
    if (!obj) return c.json({ error: "not_found" }, 404);
    return c.body(obj.body, 200, {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    });
  });

  r.delete("/:id/images/:imageId", requireTeam("content"), async (c) => {
    const articleId = c.req.param("id");
    const imageId = c.req.param("imageId");
    if (!articleId || !imageId) return c.json({ error: "not_found" }, 404);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const tenantId = c.get("tenant").id;
    const removed = await content.store.removeImage(tenantId, articleId, imageId);
    if (!removed) return c.json({ error: "not_found" }, 404);

    // Binärdatei best effort löschen (Metadaten sind die Wahrheit).
    try {
      await content.media?.delete(articleImageKey(tenantId, articleId, imageId));
    } catch (err) {
      console.error("[images] R2-Delete fehlgeschlagen:", err);
    }
    await syncIndex(tenantId, articleId);
    return c.json({ ok: true });
  });

  // ——— IMPORT/EXPORT (Content-Werkzeuge; Anti-Lock-in-USP) ———————————————

  // Vollständiger Export als JSON-Datei (alle Status, Verweise als Slugs —
  // verlustfrei reimportierbar, auch in eine ANDERE Instanz).
  r.get("/export", requireTeam("content"), async (c) => {
    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const articles = await content.store.listForTransfer(c.get("tenant").id);
    const file = buildExportFile(articles, new Date().toISOString());
    c.header(
      "content-disposition",
      `attachment; filename="hallofhelp-${c.get("tenant").slug}-artikel.json"`,
    );
    return c.json(file);
  });

  // Einzelner Artikel als Markdown (menschenlesbar; Roundtrip-Format ist JSON).
  r.get("/:id/markdown", requireTeam("content"), async (c) => {
    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const articles = await content.store.listForTransfer(c.get("tenant").id);
    const article = articles.find((a) => a.id === c.req.param("id"));
    if (!article) return c.json({ error: "not_found" }, 404);

    c.header("content-type", "text/markdown; charset=utf-8");
    c.header("content-disposition", `attachment; filename="${article.slug}.md"`);
    return c.body(articleToMarkdown(article));
  });

  /**
   * Import: JSON-Export-Datei (Bulk) ODER { markdown } (ein Artikel).
   * Upsert per Slug: existiert → Inhalts-Update OHNE Status-Änderung (+Index-
   * Sync, falls veröffentlicht); neu → DRAFT (Veröffentlichen bleibt bewusst).
   * Fehlerhafte Einträge brechen den Import NICHT ab (Bericht je Artikel).
   * Verweise (relatedSlugs) werden in einem 2. Pass auf Ids aufgelöst.
   */
  r.post("/import", requireTeam("content"), async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);
    const tenant = c.get("tenant");

    // Eingabeform normalisieren: Markdown-Einzelartikel oder Export-Datei.
    let items: RawImportArticle[];
    const rawBody = parsed.body as { markdown?: unknown };
    if (typeof rawBody?.markdown === "string") {
      const md = parseMarkdownArticle(rawBody.markdown);
      if (typeof md === "string") return c.json({ error: md }, 400);
      items = [
        {
          slug: md.slug ?? undefined,
          title: md.title,
          category: md.category ?? undefined,
          locale: md.locale ?? undefined,
          body: md.body,
        },
      ];
    } else {
      const file = parseImportFile(parsed.body);
      if (typeof file === "string") return c.json({ error: file }, 400);
      items = file;
    }

    const existing = await content.store.listForTransfer(tenant.id);
    const idBySlug = new Map(existing.map((a) => [a.slug, a.id]));
    const statusBySlug = new Map(existing.map((a) => [a.slug, a.lifecycle]));

    const report: { slug: string; action: "created" | "updated" | "failed"; error?: string }[] =
      [];
    const relatedPass: { id: string; relatedSlugs: string[] }[] = [];
    const author = await actorId(c);

    for (const [index, item] of items.entries()) {
      // Slug-Fallback: aus dem Titel ableiten (Markdown ohne Front-Matter).
      const fallbackSlug =
        typeof item.title === "string"
          ? item.title
              .toLowerCase()
              .replace(/ä/g, "ae")
              .replace(/ö/g, "oe")
              .replace(/ü/g, "ue")
              .replace(/ß/g, "ss")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 60)
          : `import-${index + 1}`;
      const slug = typeof item.slug === "string" && item.slug.length > 0 ? item.slug : fallbackSlug;

      const createShape = {
        slug,
        title: item.title,
        category: item.category ?? "Import",
        locale: item.locale,
        body: item.body,
        videos: item.videos ?? [],
        readingMinutes: item.readingMinutes,
      };
      const valid = parseCreateArticle(createShape, tenant.defaultLocale);
      if (!valid.ok) {
        report.push({ slug, action: "failed", error: valid.error });
        continue;
      }

      const relatedSlugs = Array.isArray(item.relatedSlugs)
        ? item.relatedSlugs.filter((s): s is string => typeof s === "string")
        : [];

      try {
        const existingId = idBySlug.get(valid.value.slug);
        if (existingId) {
          await content.store.update(
            tenant.id,
            existingId,
            {
              title: valid.value.title,
              category: valid.value.category,
              body: valid.value.body,
              videos: valid.value.videos,
              readingMinutes: valid.value.readingMinutes,
            },
            author,
          );
          // Nur Veröffentlichtes ist im Index — Drafts hält der Sync fern.
          if (statusBySlug.get(valid.value.slug) === "published") {
            await syncIndex(tenant.id, existingId);
          }
          relatedPass.push({ id: existingId, relatedSlugs });
          report.push({ slug: valid.value.slug, action: "updated" });
        } else {
          const id = await content.store.create(tenant.id, valid.value);
          idBySlug.set(valid.value.slug, id);
          relatedPass.push({ id, relatedSlugs });
          report.push({ slug: valid.value.slug, action: "created" });
        }
      } catch (err) {
        if (err instanceof SlugConflictError) {
          report.push({ slug: valid.value.slug, action: "failed", error: "slug_conflict" });
        } else {
          console.error("[import] Artikel fehlgeschlagen:", err);
          report.push({ slug: valid.value.slug, action: "failed", error: "import_failed" });
        }
      }
    }

    // Pass 2: Querverweise auf Ids auflösen (nur auflösbare; Reihenfolge egal).
    for (const entry of relatedPass) {
      const relatedIds = entry.relatedSlugs
        .map((s) => idBySlug.get(s))
        .filter((id): id is string => typeof id === "string" && id !== entry.id);
      if (relatedIds.length > 0) {
        await content.store.update(tenant.id, entry.id, { relatedIds }, author);
      }
    }

    return c.json({
      ok: true,
      created: report.filter((r2) => r2.action === "created").length,
      updated: report.filter((r2) => r2.action === "updated").length,
      failed: report.filter((r2) => r2.action === "failed").length,
      items: report,
    });
  });

  r.delete("/:id", requireTeam("content"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const ok = await content.store.remove(c.get("tenant").id, id);
    if (!ok) return c.json({ error: "not_found" }, 404);
    await syncIndex(c.get("tenant").id, id);
    return c.json({ ok: true });
  });

  return r;
}

/**
 * ÖFFENTLICHES BILD-SERVING — `GET /api/v1/content/images/:articleKey/:imageId`
 * (PUBLIC-Prefix, Begründung in public-routes.ts). FAIL-CLOSED: ausgeliefert
 * wird NUR, wenn der per Host aufgelöste Tenant einen VERÖFFENTLICHTEN
 * Artikel (id ODER slug) mit genau dieser Bild-Id hat — Draft-Bilder sind
 * damit nie erreichbar, fremde Tenants sowieso nicht (Key wird serverseitig
 * aus tenant+article+image abgeleitet). Bild-Ids sind einmalig und Inhalte
 * hinter einer Id unveränderlich (Löschen+Neu statt Ersetzen) → immutable-
 * Cache ist korrekt.
 */
export function contentImagesPublicRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.get("/:articleKey/:imageId", async (c) => {
    const content = await deps.getContentDeps();
    if (!content?.media) return c.json({ error: "media_unavailable" }, 503);

    const tenantId = c.get("tenant").id;
    const found = await content.store.getPublishedImage(
      tenantId,
      c.req.param("articleKey"),
      c.req.param("imageId"),
    );
    if (!found) return c.json({ error: "not_found" }, 404);

    const obj = await content.media.get(
      articleImageKey(tenantId, found.articleId, found.image.id),
    );
    if (!obj) return c.json({ error: "not_found" }, 404);

    return c.body(obj.body, 200, {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
  });

  return r;
}
