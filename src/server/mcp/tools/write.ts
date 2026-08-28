import { readPlanState } from "@/server/billing/store";
import { SlugConflictError } from "@/server/content/store";
import {
  estimateReadingMinutes,
  parseCreateArticle,
  parseUpdateArticle,
  parseYouTubeId,
} from "@/server/content/validate";
import {
  fetchVideoTitle,
  MAX_TRANSCRIPT_CHARS,
  normalizePastedTranscript,
  tryFetchTranscript,
} from "@/server/content/video-meta";
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
      on_conflict: {
        type: "string",
        enum: ["fail", "update"],
        description:
          "What to do if an article with that slug already exists. 'fail' (default) returns slug_conflict; 'update' overwrites its content and keeps its publication status — that makes a migration repeatable without deleting first.",
      },
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

    // Wiederholbarkeit: Ein Agent, der seinen Lauf erneut fährt, soll nicht
    // erst löschen müssen. Mit on_conflict:"update" wird der bestehende
    // Artikel inhaltlich überschrieben — sein Status bleibt unangetastet.
    const wantsUpdate = args.on_conflict === "update";
    let existingId: string | null = null;
    if (wantsUpdate) {
      const rows = await content.store.listForTransfer(ctx.tenant.id);
      existingId = rows.find((a) => a.slug === parsed.value.slug)?.id ?? null;
    }

    try {
      let id: string;
      if (existingId) {
        await content.store.update(
          ctx.tenant.id,
          existingId,
          {
            title: parsed.value.title,
            category: parsed.value.category,
            body: parsed.value.body,
            videos: parsed.value.videos,
            readingMinutes: parsed.value.readingMinutes,
          },
          null,
        );
        id = existingId;
      } else {
        id = await content.store.create(ctx.tenant.id, parsed.value);
      }

      // Bilder erst NACH dem Anlegen: sie hängen am Artikel, brauchen also
      // dessen Id. Was nicht lädt, verliert seinen Block (nie ein Verweis ins
      // Leere — der würde unsichtbar rendern).
      const media = await downloadScrapedImages(content, ctx.tenant.id, id, scraped, parsed.value.body);
      if (media.imported > 0 || media.failed > 0) {
        await content.store.update(ctx.tenant.id, id, { body: media.blocks }, null);
      }

      await audit(ctx, existingId ? "mcp.article.updated" : "mcp.article.created", id, {
        slug: parsed.value.slug,
        source: check.url.host,
      });
      return ok({
        id,
        slug: parsed.value.slug,
        status: existingId ? "updated" : "draft",
        title: scraped.title,
        imported: {
          blocks: media.blocks.length,
          images: media.imported,
          imagesFailed: media.failed,
          videos: videos.length,
        },
        imageFailures: media.failures,
        emptySections: emptySectionTitles(media.blocks),
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

/** Deckel je Stapel — genug für den größten Artikel, klein genug fürs Zeitbudget. */
const MAX_DESCRIPTION_BATCH = 40;

/**
 * Überschriften ohne Inhalt nach einem Import. Fremde Hilfeseiten beenden
 * Artikel gern mit Kachel-Navigationen; der Importer findet dort keinen Text,
 * die Überschrift bleibt nackt stehen. Wer das nicht gesagt bekommt, merkt es
 * erst, wenn ein Leser davorsteht (Migrations-Fund 2026-08-28).
 */
function emptySectionTitles(blocks: { type: string; variant?: string; text?: string }[]): string[] {
  const out: string[] = [];
  const isHeading = (b?: { type: string; text?: string }) =>
    b?.type === "text" && typeof b.text === "string" && b.text.trimStart().startsWith("#");
  blocks.forEach((b, i) => {
    if (!isHeading(b)) return;
    const next = blocks[i + 1];
    if (next === undefined || isHeading(next)) out.push((b.text ?? "").replace(/^#+\s*/, "").trim());
  });
  return out;
}

export const updateImageDescriptions: McpTool = {
  name: "update_image_descriptions",
  title: "Bildbeschreibungen im Stapel ändern",
  description:
    "Set the descriptions of MANY images on one article in a single call. Use this instead of calling update_image_description in a loop — a migration otherwise costs one round trip per image. Each entry is applied independently: a bad one is reported and the rest still go through.",
  scope: "articles:write",
  annotations: { ...WRITE_HINTS, idempotentHint: true },
  inputSchema: {
    type: "object",
    properties: {
      articleId: { type: "string" },
      descriptions: {
        type: "array",
        description: `Up to ${MAX_DESCRIPTION_BATCH} entries of { imageId, description }.`,
        items: {
          type: "object",
          properties: { imageId: { type: "string" }, description: { type: "string" } },
          required: ["imageId", "description"],
        },
      },
    },
    required: ["articleId", "descriptions"],
  },
  async handler(args, ctx) {
    if (typeof args.articleId !== "string") return fail("invalid_params", "`articleId` must be a string.");
    if (!Array.isArray(args.descriptions) || args.descriptions.length === 0) {
      return fail("invalid_params", "`descriptions` must be a non-empty array.");
    }
    if (args.descriptions.length > MAX_DESCRIPTION_BATCH) {
      return fail("too_many_items", `At most ${MAX_DESCRIPTION_BATCH} entries per call.`);
    }

    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    const results: { imageId: string; ok: boolean; error?: string }[] = [];
    for (const raw of args.descriptions) {
      const e = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      const imageId = typeof e.imageId === "string" ? e.imageId : "";
      const description = typeof e.description === "string" ? e.description.trim() : "";
      if (imageId.length === 0) {
        results.push({ imageId: "", ok: false, error: "invalid_params" });
        continue;
      }
      if (description.length === 0) {
        results.push({ imageId, ok: false, error: "image_description_required" });
        continue;
      }
      const done = await content.store.updateImageDescription(
        ctx.tenant.id,
        args.articleId,
        imageId,
        description,
      );
      results.push(done ? { imageId, ok: true } : { imageId, ok: false, error: "not_found" });
    }

    const updated = results.filter((r) => r.ok).length;
    if (updated > 0) {
      await audit(ctx, "mcp.article.updated", args.articleId, { images: updated });
    }
    return ok({
      articleId: args.articleId,
      updated,
      failed: results.filter((r) => !r.ok),
    });
  },
};

export const updateVideo: McpTool = {
  name: "update_video",
  title: "Video-Angaben ändern",
  description:
    "Change title, description or duration label of ONE video on an article, without touching the others. Prefer this over update_article with a full `videos` array — that replaces the whole list and silently drops fields you forget. The description is what the AI search reads about a video: describe what the video SHOWS, not just what it is called. If you do not know the content, use prepare_video with a transcript instead of inventing one.",
  scope: "articles:write",
  annotations: { ...WRITE_HINTS, idempotentHint: true },
  inputSchema: {
    type: "object",
    properties: {
      articleId: { type: "string" },
      videoId: { type: "string", description: "Id of a video on that article (see get_article)." },
      title: { type: "string" },
      description: { type: "string", description: "What the video shows. Must not be empty if passed." },
      durationLabel: { type: "string", description: "Display label such as '3:20'. Empty hides it." },
    },
    required: ["articleId", "videoId"],
  },
  async handler(args, ctx) {
    if (typeof args.articleId !== "string") return fail("invalid_params", "`articleId` must be a string.");
    if (typeof args.videoId !== "string") return fail("invalid_params", "`videoId` must be a string.");

    const patch: { title?: string; description?: string; durationLabel?: string } = {};
    if (args.title !== undefined) {
      if (typeof args.title !== "string" || args.title.trim().length === 0) {
        return fail("invalid_params", "`title` must be a non-empty string.");
      }
      patch.title = args.title.trim();
    }
    if (args.description !== undefined) {
      if (typeof args.description !== "string" || args.description.trim().length === 0) {
        return fail(
          "video_description_required",
          "`description` must not be empty — a video without a description is invisible to the AI search.",
        );
      }
      patch.description = args.description.trim();
    }
    if (args.durationLabel !== undefined) {
      if (typeof args.durationLabel !== "string") return fail("invalid_params", "`durationLabel` must be a string.");
      patch.durationLabel = args.durationLabel.trim();
    }
    if (Object.keys(patch).length === 0) {
      return fail("empty_update", "Pass at least one of `title`, `description` or `durationLabel`.");
    }

    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    const done = await content.store.updateVideo(ctx.tenant.id, args.articleId, args.videoId, patch);
    if (!done) return fail("not_found", `No video '${args.videoId}' on article '${args.articleId}'.`);

    await syncIndex(ctx, args.articleId);
    await audit(ctx, "mcp.article.updated", args.articleId, { videoId: args.videoId });
    return ok({ articleId: args.articleId, videoId: args.videoId, updated: Object.keys(patch) });
  },
};

export const prepareVideo: McpTool = {
  name: "prepare_video",
  title: "Videoinhalt erfassen",
  description:
    "Turn a YouTube video into a title and a real description using its TRANSCRIPT. The transcript is the whole point: without it nothing is generated, because an invented description would end up in the AI search index. YouTube blocks automated transcript access from servers, so pass the transcript yourself — open the video, '…' → 'Show transcript', copy it. Costs credits (our AI does the summarising). This tool only RETURNS the result; write it with update_video.",
  scope: "articles:write",
  annotations: { ...WRITE_HINTS, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      youtubeUrl: { type: "string", description: "YouTube URL or the bare 11-character video id." },
      transcript: {
        type: "string",
        description:
          "The video transcript. Optional — the server tries to fetch it, but that usually fails; then you get `transcript_required` back.",
      },
    },
    required: ["youtubeUrl"],
  },
  async handler(args, ctx) {
    if (typeof args.youtubeUrl !== "string") return fail("invalid_params", "`youtubeUrl` must be a string.");
    const youtubeId = parseYouTubeId(args.youtubeUrl);
    if (!youtubeId) return fail("youtube_url_invalid", "That is not a valid YouTube URL or video id.");
    if (typeof args.transcript === "string" && args.transcript.length > MAX_TRANSCRIPT_CHARS * 2) {
      return fail("transcript_too_large", "The transcript is too long.");
    }
    if (await frozen(ctx)) return FROZEN_RESULT();

    // Titel zuerst — kostenlos und auch ohne Transkript nützlich.
    const youtubeTitle = await fetchVideoTitle(youtubeId);
    const pasted =
      typeof args.transcript === "string" ? normalizePastedTranscript(args.transcript) : "";
    const transcript = pasted.length > 0 ? pasted : await tryFetchTranscript(youtubeId);

    if (!transcript || transcript.length < 40) {
      // EHRLICH: ohne Inhalt keine Beschreibung — und keine Credits.
      return fail(
        "transcript_required",
        "No transcript available, so no description was generated (we do not invent one). Open the video on YouTube, '…' → 'Show transcript', copy it and pass it as `transcript`.",
        { youtubeId, youtubeTitle },
      );
    }

    const summarize = await ctx.deps.getVideoSummarizer?.();
    if (!summarize) return fail("summarizer_unavailable", "AI video summarising is not available here.");

    let result;
    try {
      result = await summarize({ transcript, videoTitle: youtubeTitle, locale: ctx.tenant.defaultLocale });
    } catch (err) {
      console.error("[mcp] Video-Aufbereitung fehlgeschlagen:", err);
      return fail("summary_failed", "The AI could not summarise this transcript. Nothing was charged.");
    }

    // Credits erst bei Erfolg — Fehlschläge kosten nichts (wie im Editor).
    try {
      const billing = await ctx.deps.getBillingDeps?.();
      await billing?.repo.recordAiVideoSummary({
        tenantId: ctx.tenant.id,
        actorType: "internal",
        visitorId: `k:${ctx.principal.keyId}`,
        userId: null,
        nowSec: ctx.nowSec,
      });
    } catch (err) {
      console.error("[mcp] Credit-Verbuchung fehlgeschlagen (ignoriert):", err);
    }

    return ok({
      youtubeId,
      title: result.title,
      youtubeTitle,
      description: result.description,
      transcriptSource: pasted.length > 0 ? "pasted" : "fetched",
      untrustedContent: UNTRUSTED_NOTE,
      note: "Nothing was saved yet. Write the result with update_video.",
    });
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
  updateImageDescriptions,
  updateVideo,
  prepareVideo,
  importArticleFromUrl,
  publishArticle,
  unpublishArticle,
];
