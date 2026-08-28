import { readPlanState } from "@/server/billing/store";
import { SlugConflictError } from "@/server/content/store";
import { estimateReadingMinutes, parseCreateArticle, parseUpdateArticle } from "@/server/content/validate";
import { assertImportableUrl, extractArticleFromHtml, slugFromUrl } from "@/server/content/scrape";
import {
  applyVideoIds,
  downloadScrapedImages,
  importImageFromUrl,
  resolveScrapedVideos,
  IMPORT_USER_AGENT,
  IMPORT_FETCH_TIMEOUT_MS,
  type ImageImportError,
} from "@/server/content/media-import";
import { fail, ok, UNTRUSTED_NOTE, type McpTool, type ToolContext } from "./types";

/**
 * SCHREIB-WERKZEUGE (Stufe 2 gelb + Stufe 3 orange).
 *
 * ZWEI REGELN, die hier überall gelten:
 *  1. ENTWURF ZUERST. `create_article` erzeugt niemals etwas Öffentliches —
 *     Veröffentlichen ist ein eigenes Werkzeug mit eigener Berechtigung. Ein
 *     halluzinierter Artikel darf nicht ohne Menschen auf der Kundendomain
 *     landen (docs/mcp-plan.md §4 E5).
 *  2. DIESELBE VALIDIERUNG wie die REST-API (`validate.ts`). Der MCP-Server ist
 *     eine zweite Tür zum selben Haus, kein zweites Regelwerk — sonst driften
 *     die Grenzen auseinander und eine Tür wird zur Lücke.
 */

const WRITE_HINTS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;
const MAX_PAGE_CHARS = 2_000_000;
const IMPORT_CATEGORY = "Import";

/**
 * FREEZE-GATE für Werkzeuge — dieselbe Regel wie `freezeGate` (Middleware) auf
 * dem Menschen-Pfad: nach abgelaufener Grace sind Mutationen gesperrt. Ohne
 * Billing-Daten wird NICHT geraten (die Fach-Aufrufe scheitern dann ohnehin).
 */
async function frozen(ctx: ToolContext): Promise<boolean> {
  const billing = await ctx.deps.getBillingDeps?.();
  if (!billing) return false;
  const state = await readPlanState(billing.repo, ctx.tenant.id, ctx.nowSec);
  return state.status === "frozen";
}

const FROZEN_RESULT = () =>
  fail(
    "payment_required",
    "This help center is frozen because its plan limit was exceeded. Content changes are blocked until the plan is upgraded — reading still works.",
  );

/** Audit-Eintrag; non-blocking (ein Log-Ausfall kippt keine fachliche Aktion). */
async function audit(
  ctx: ToolContext,
  action:
    | "mcp.article.created"
    | "mcp.article.updated"
    | "mcp.article.published"
    | "mcp.article.unpublished"
    | "mcp.article.deleted"
    | "mcp.article.image_added",
  targetId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const team = await ctx.deps.getTeamDeps();
    await team?.audit.append({
      tenantId: ctx.tenant.id,
      // Kein User: gehandelt hat der Schlüssel. Wer ihn erzeugt hat, steht in
      // der Key-Liste — hier zählt, WELCHER Schlüssel es war.
      actorId: null,
      action,
      targetId,
      metadata: { keyId: ctx.principal.keyId, keyName: ctx.principal.name, ...metadata },
    });
  } catch (err) {
    console.error("[mcp] Audit fehlgeschlagen (ignoriert):", err);
  }
}

/** Index-Sync wie in der REST-Route: best effort, nie ein Blocker. */
async function syncIndex(ctx: ToolContext, articleId: string): Promise<void> {
  try {
    const indexer = await ctx.deps.getContentIndexer?.();
    await indexer?.onContentChange(ctx.tenant.id, articleId);
  } catch (err) {
    console.error("[mcp] Index-Sync fehlgeschlagen (ignoriert):", err);
  }
}

export const createArticle: McpTool = {
  name: "create_article",
  title: "Artikel anlegen",
  description:
    "Create a new help article. It is always created as a DRAFT and is not visible to end users until someone publishes it. Call get_content_conventions first to learn the block format.",
  scope: "articles:write",
  annotations: WRITE_HINTS,
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "Lowercase, hyphen-separated, unique per locale." },
      title: { type: "string" },
      category: { type: "string", description: "Prefer an existing category (see list_categories)." },
      body: {
        type: "array",
        description: "Array of typed blocks (see get_content_conventions). Strings are treated as text blocks.",
        items: {},
      },
      locale: { type: "string", description: "Defaults to the help center's default locale." },
      aiGenerated: {
        type: "boolean",
        description:
          "Mark the article as AI-generated in the help center (default false). Set true if you want readers to see that badge.",
      },
    },
    required: ["slug", "title", "category", "body"],
  },
  async handler(args, ctx) {
    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    const parsed = parseCreateArticle(args, ctx.tenant.defaultLocale);
    if (!parsed.ok) {
      return fail(parsed.error, `The article was rejected by validation: ${parsed.error}.`);
    }

    try {
      const id = await content.store.create(ctx.tenant.id, parsed.value);
      await audit(ctx, "mcp.article.created", id, { slug: parsed.value.slug });
      return ok({
        id,
        slug: parsed.value.slug,
        status: "draft",
        note: "Created as a draft. Use publish_article to make it visible — that requires the publish permission.",
      });
    } catch (err) {
      if (err instanceof SlugConflictError) {
        return fail(
          "slug_conflict",
          `The slug '${parsed.value.slug}' is already used in this locale. Choose a different slug, or update the existing article instead.`,
        );
      }
      throw err;
    }
  },
};

export const updateArticle: McpTool = {
  name: "update_article",
  title: "Artikel aktualisieren",
  description:
    "Update an existing article (partial: only the fields you pass change). Creates a version snapshot. Read the article with get_article first so you keep the parts you do not want to change.",
  scope: "articles:write",
  annotations: { ...WRITE_HINTS, idempotentHint: true },
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      category: { type: "string" },
      body: { type: "array", items: {} },
      videos: {
        type: "array",
        description:
          "REPLACES the article's video list. Each entry: { id, title, description, youtubeId, durationLabel? }. `description` is REQUIRED and is what the AI search reads — write what the video actually shows, not just its title. Keep existing ids (from get_article) to edit rather than replace.",
        items: {},
      },
      aiGenerated: { type: "boolean" },
    },
    required: ["id"],
  },
  async handler(args, ctx) {
    if (typeof args.id !== "string") return fail("invalid_params", "`id` must be a string.");
    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    const parsed = parseUpdateArticle(args);
    if (!parsed.ok) return fail(parsed.error, `The update was rejected by validation: ${parsed.error}.`);

    // Lesezeit mitziehen, wenn sich der Text geändert hat (die REST-Route tut
    // dasselbe über den Editor — hier gibt es keinen, der es nachreicht).
    if (parsed.value.body && parsed.value.readingMinutes === undefined) {
      parsed.value.readingMinutes = estimateReadingMinutes(parsed.value.body);
    }

    // authorId bleibt null: gehandelt hat ein Schlüssel, kein Konto — eine
    // User-Id vorzutäuschen wäre falsch. Der Schlüssel steht im Audit-Log.
    const updated = await content.store.update(ctx.tenant.id, args.id, parsed.value, null);
    if (!updated) return fail("not_found", `No article with id '${args.id}'.`);

    await syncIndex(ctx, args.id);
    await audit(ctx, "mcp.article.updated", args.id, { fields: Object.keys(parsed.value) });
    return ok({ id: args.id, updated: Object.keys(parsed.value) });
  },
};

export const importArticleFromUrl: McpTool = {
  name: "import_article_from_url",
  title: "Artikel aus URL importieren",
  description:
    "Fetch a public web page and turn it into a DRAFT article, keeping the original order of text, tables, images and YouTube videos. Images are downloaded into this help center; their alt text becomes the image description. Useful for migrating existing documentation — you own the content or have the rights to it.",
  scope: "articles:write",
  annotations: { ...WRITE_HINTS, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Public https URL of the page to import." },
      category: { type: "string", description: `Target category (default '${IMPORT_CATEGORY}').` },
      slug: { type: "string", description: "Override the slug derived from the URL." },
    },
    required: ["url"],
  },
  async handler(args, ctx) {
    if (typeof args.url !== "string") return fail("invalid_params", "`url` must be a string.");
    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    // SSRF-Riegel: dieselbe Prüfung wie die REST-Route (kein localhost, keine
    // privaten Netze, nur http/https) — der Server darf nicht zum Werkzeug
    // werden, um interne Adressen abzuklopfen.
    const check = assertImportableUrl(args.url);
    if (!check.ok) return fail(check.error, `This URL cannot be imported: ${check.error}.`);

    let html: string;
    try {
      const res = await fetch(check.url.toString(), {
        headers: { accept: "text/html", "user-agent": IMPORT_USER_AGENT },
        signal: AbortSignal.timeout(IMPORT_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return fail(`http_${res.status}`, `The page returned HTTP ${res.status}.`);
      if (!(res.headers.get("content-type") ?? "").includes("html")) {
        return fail("not_html", "The URL did not return an HTML page.");
      }
      html = await res.text();
      if (html.length > MAX_PAGE_CHARS) return fail("page_too_large", "The page is too large to import.");
    } catch {
      return fail("fetch_failed", "The page could not be fetched.");
    }

    const scraped = extractArticleFromHtml(html, check.url);
    if (scraped.title.length === 0 || scraped.blocks.length === 0) {
      return fail("no_content_found", "No usable article content was found on that page.");
    }

    // Videos ZUERST: Aus den gescrapten YouTube-Verweisen werden echte
    // Einträge (Titel per oEmbed), bevor der Artikel entsteht — sonst zeigen
    // die Video-Blöcke im Body auf Ids, die es nicht gibt.
    const { videos, idByPlaceholder } = await resolveScrapedVideos(scraped);

    const parsed = parseCreateArticle(
      {
        slug: typeof args.slug === "string" ? args.slug : slugFromUrl(check.url),
        title: scraped.title,
        category: typeof args.category === "string" ? args.category : IMPORT_CATEGORY,
        body: applyVideoIds(scraped.blocks, idByPlaceholder),
        videos,
        locale: ctx.tenant.defaultLocale,
      },
      ctx.tenant.defaultLocale,
    );
    if (!parsed.ok) return fail(parsed.error, `The imported page did not pass validation: ${parsed.error}.`);

    try {
      const id = await content.store.create(ctx.tenant.id, parsed.value);

      // Bilder erst NACH dem Anlegen: sie hängen am Artikel, brauchen also
      // dessen Id. Was nicht lädt, verliert seinen Block (nie ein Verweis ins
      // Leere — der würde unsichtbar rendern).
      const media = await downloadScrapedImages(content, ctx.tenant.id, id, scraped, parsed.value.body);
      if (media.imported > 0 || media.failed > 0) {
        await content.store.update(ctx.tenant.id, id, { body: media.blocks }, null);
      }

      await audit(ctx, "mcp.article.created", id, { slug: parsed.value.slug, source: check.url.host });
      return ok({
        id,
        slug: parsed.value.slug,
        status: "draft",
        title: scraped.title,
        imported: {
          blocks: media.blocks.length,
          images: media.imported,
          imagesFailed: media.failed,
          videos: videos.length,
        },
        warnings: [...new Set(scraped.warnings)],
        untrustedContent: UNTRUSTED_NOTE,
        note:
          videos.length > 0
            ? "Imported as a draft. Image descriptions came from the source page's alt text and video descriptions are only the video title — improve both with update_article and add_image_from_url before publishing."
            : "Imported as a draft. Image descriptions came from the source page's alt text — check them before publishing.",
      });
    } catch (err) {
      if (err instanceof SlugConflictError) {
        return fail("slug_conflict", `The slug '${parsed.value.slug}' already exists. Pass a different \`slug\`.`);
      }
      throw err;
    }
  },
};

/**
 * Klartext-Begründung je Fehlercode. Das Client-LLM soll sich selbst
 * korrigieren können („zu groß → anderes Bild"), nicht nur einen Code sehen.
 */
const IMAGE_ERROR_MESSAGES: Record<ImageImportError, string> = {
  invalid_url: "The image URL is not a valid http(s) address.",
  url_not_allowed: "That address cannot be fetched (only public http/https hosts are allowed).",
  media_unavailable: "Image storage is not available for this help center.",
  fetch_failed: "The image could not be downloaded from that address.",
  image_too_large: "The image is larger than 2 MB. Use a smaller version.",
  unsupported_image_type: "Only PNG, JPEG and WebP images are supported.",
  not_found: "No article with that id.",
  too_many_images: "This article already has the maximum number of images.",
};

export const addImageFromUrl: McpTool = {
  name: "add_image_from_url",
  title: "Bild aus URL hinzufügen",
  description:
    "Download a publicly reachable image and attach it to an article. Returns an imageId — reference it from the body with a block { \"type\": \"image\", \"imageId\": \"…\" } via update_article, otherwise the image is stored but never shown. The description is REQUIRED: it is the alt text AND the only part of an image the AI search can read, so describe what the image actually SHOWS (\"Einstellungen-Dialog mit aktiviertem Schalter 'Automatisch antworten'\"), not what it is called (\"Screenshot 3\").",
  scope: "articles:write",
  annotations: { ...WRITE_HINTS, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      articleId: { type: "string", description: "Id of the article this image belongs to." },
      url: {
        type: "string",
        description: "Public http(s) URL of the image. PNG, JPEG or WebP, at most 2 MB.",
      },
      description: {
        type: "string",
        description: "What the image shows, written in the help center's language. Required, must not be empty.",
      },
    },
    required: ["articleId", "url", "description"],
  },
  async handler(args, ctx) {
    if (typeof args.articleId !== "string") return fail("invalid_params", "`articleId` must be a string.");
    if (typeof args.url !== "string") return fail("invalid_params", "`url` must be a string.");
    const description = typeof args.description === "string" ? args.description.trim() : "";
    if (description.length === 0) {
      return fail(
        "image_description_required",
        "`description` is required and must not be empty — it is the alt text and the only thing the AI search can read about an image.",
      );
    }

    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    const res = await importImageFromUrl(content, ctx.tenant.id, args.articleId, {
      url: args.url,
      description,
    });
    if (!res.ok) return fail(res.error, IMAGE_ERROR_MESSAGES[res.error]);

    await audit(ctx, "mcp.article.image_added", args.articleId, { imageId: res.imageId });
    return ok({
      imageId: res.imageId,
      articleId: args.articleId,
      note: "Stored. The image is only visible once you reference it from the article body: add { \"type\": \"image\", \"imageId\": \"" + res.imageId + "\" } with update_article.",
    });
  },
};

export const updateImageDescription: McpTool = {
  name: "update_image_description",
  title: "Bildbeschreibung ändern",
  description:
    "Rewrite the description of an image that is already attached to an article. Use this after importing pages: source pages usually carry a label as alt text (\"Screenshot: settings\") rather than a description, and the description is the only part of an image the AI search can read. Look at the image before writing — get_article lists the images with their current descriptions.",
  scope: "articles:write",
  annotations: { ...WRITE_HINTS, idempotentHint: true },
  inputSchema: {
    type: "object",
    properties: {
      articleId: { type: "string" },
      imageId: { type: "string", description: "Id of an image on that article (see get_article)." },
      description: {
        type: "string",
        description: "What the image shows, in the help center's language. Required, must not be empty.",
      },
    },
    required: ["articleId", "imageId", "description"],
  },
  async handler(args, ctx) {
    if (typeof args.articleId !== "string") return fail("invalid_params", "`articleId` must be a string.");
    if (typeof args.imageId !== "string") return fail("invalid_params", "`imageId` must be a string.");
    const description = typeof args.description === "string" ? args.description.trim() : "";
    if (description.length === 0) {
      return fail(
        "image_description_required",
        "`description` is required and must not be empty — an image without a description is invisible to the AI search.",
      );
    }

    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    const done = await content.store.updateImageDescription(
      ctx.tenant.id,
      args.articleId,
      args.imageId,
      description,
    );
    if (!done) return fail("not_found", `No image '${args.imageId}' on article '${args.articleId}'.`);

    await audit(ctx, "mcp.article.updated", args.articleId, { imageId: args.imageId });
    return ok({ articleId: args.articleId, imageId: args.imageId, description });
  },
};

export const publishArticle: McpTool = {
  name: "publish_article",
  title: "Artikel veröffentlichen",
  description:
    "Publish an article. It becomes visible to ALL end users of this help center immediately. Ask the user for confirmation before calling this.",
  scope: "articles:publish",
  annotations: WRITE_HINTS,
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  async handler(args, ctx) {
    if (typeof args.id !== "string") return fail("invalid_params", "`id` must be a string.");
    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    const done = await content.store.publish(ctx.tenant.id, args.id, null);
    if (!done) return fail("not_found", `No article with id '${args.id}'.`);

    await syncIndex(ctx, args.id);
    await audit(ctx, "mcp.article.published", args.id);
    return ok({ id: args.id, status: "published" });
  },
};

export const unpublishArticle: McpTool = {
  name: "unpublish_article",
  title: "Artikel zurückziehen",
  description:
    "Take an article offline (back to draft). Nothing is deleted — this is the safe way to remove something from the public help center.",
  scope: "articles:publish",
  annotations: { ...WRITE_HINTS, idempotentHint: true },
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  async handler(args, ctx) {
    if (typeof args.id !== "string") return fail("invalid_params", "`id` must be a string.");
    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    const done = await content.store.unpublish(ctx.tenant.id, args.id);
    if (!done) return fail("not_found", `No article with id '${args.id}'.`);

    await syncIndex(ctx, args.id);
    await audit(ctx, "mcp.article.unpublished", args.id);
    return ok({ id: args.id, status: "draft" });
  },
};

export const WRITE_TOOLS: McpTool[] = [
  createArticle,
  updateArticle,
  addImageFromUrl,
  updateImageDescription,
  importArticleFromUrl,
  publishArticle,
  unpublishArticle,
];
