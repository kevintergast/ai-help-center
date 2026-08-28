import {
  MAX_BODY_BLOCKS,
  MAX_CATEGORY_LENGTH,
  MAX_SLUG_LENGTH,
  MAX_TITLE_LENGTH,
  RESERVED_SLUGS,
} from "@/server/content/validate";
import { MAX_LINK_CARDS, TAG_COLORS, TEXT_VARIANTS } from "@/lib/content/blocks";
import { API_SCOPES, scopeDef } from "@/server/apikeys/scopes";
import { fail, ok, type McpTool, type ToolContext } from "./types";

/**
 * LESE-WERKZEUGE (Stufe 1). Alles hier ist folgenlos: kein Schreibpfad, keine
 * Kosten, `readOnlyHint`.
 *
 * `get_content_conventions` ist das wichtigste Werkzeug des ganzen Servers:
 * unser Artikel-Körper ist kein Markdown, sondern eine typisierte Block-Liste.
 * Ohne diese Auskunft rät das Modell die Struktur und scheitert an der
 * Validierung; mit ihr schreibt es beim ersten Versuch gültige Artikel.
 */

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

async function contentOr503(ctx: ToolContext) {
  const content = await ctx.deps.getContentDeps();
  return content ?? null;
}

export const listArticles: McpTool = {
  name: "list_articles",
  title: "Artikel auflisten",
  description:
    "List all help articles of this help center including drafts, with id, slug, title, category, status and last update.",
  scope: "articles:read",
  annotations: READ_ONLY,
  inputSchema: {
    type: "object",
    properties: {
      locale: {
        type: "string",
        description: "Locale to list (defaults to the help center's default locale).",
      },
    },
  },
  async handler(args, ctx) {
    const content = await contentOr503(ctx);
    if (!content) return fail("content_unavailable", "Content storage is not available.");

    const locale = typeof args.locale === "string" ? args.locale : ctx.tenant.defaultLocale;
    const rows = await content.store.listAdminRows(ctx.tenant.id, locale);
    return ok({ locale, count: rows.length, articles: rows });
  },
};

export const getArticle: McpTool = {
  name: "get_article",
  title: "Artikel lesen",
  description:
    "Read one article by id, including its typed body blocks, videos, images and metadata. Use this before updating an article.",
  scope: "articles:read",
  annotations: READ_ONLY,
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Article id (from list_articles)." },
      locale: { type: "string" },
    },
    required: ["id"],
  },
  async handler(args, ctx) {
    if (typeof args.id !== "string") return fail("invalid_params", "`id` must be a string.");
    const content = await contentOr503(ctx);
    if (!content) return fail("content_unavailable", "Content storage is not available.");

    const locale = typeof args.locale === "string" ? args.locale : ctx.tenant.defaultLocale;
    const article = await content.store.getForEdit(ctx.tenant.id, args.id, locale);
    if (!article) return fail("not_found", `No article with id '${args.id}'.`);
    return ok(article);
  },
};

export const searchArticles: McpTool = {
  name: "search_articles",
  title: "Artikel durchsuchen",
  description:
    "Search published articles by title and category. Returns lightweight summaries — use get_article for full content.",
  scope: "articles:read",
  annotations: READ_ONLY,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Case-insensitive substring to look for." },
      locale: { type: "string" },
    },
    required: ["query"],
  },
  async handler(args, ctx) {
    if (typeof args.query !== "string") return fail("invalid_params", "`query` must be a string.");
    const content = await contentOr503(ctx);
    if (!content) return fail("content_unavailable", "Content storage is not available.");

    const locale = typeof args.locale === "string" ? args.locale : ctx.tenant.defaultLocale;
    const needle = args.query.trim().toLowerCase();
    const items = await content.store.searchItems(ctx.tenant.id, locale);
    const matches = items.filter(
      (i) => i.title.toLowerCase().includes(needle) || i.category.toLowerCase().includes(needle),
    );
    return ok({ query: args.query, count: matches.length, results: matches });
  },
};

export const listCategories: McpTool = {
  name: "list_categories",
  title: "Kategorien auflisten",
  description:
    "List the categories of this help center with their published articles. Use an existing category name when creating articles instead of inventing new ones.",
  scope: "articles:read",
  annotations: READ_ONLY,
  inputSchema: { type: "object", properties: { locale: { type: "string" } } },
  async handler(args, ctx) {
    const content = await contentOr503(ctx);
    if (!content) return fail("content_unavailable", "Content storage is not available.");

    const locale = typeof args.locale === "string" ? args.locale : ctx.tenant.defaultLocale;
    const groups = await content.store.listByCategory(ctx.tenant.id, locale);
    return ok({
      locale,
      categories: groups.map((g) => ({
        category: g.category,
        articles: g.articles.map((a) => ({ id: a.id, slug: a.slug, title: a.title })),
      })),
    });
  },
};

export const listTranslations: McpTool = {
  name: "list_translations",
  title: "Übersetzungen auflisten",
  description:
    "List all language versions of an article set, including whether a translation is older than its source (and therefore stale).",
  scope: "articles:read",
  annotations: READ_ONLY,
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "Id of any article in the set." } },
    required: ["id"],
  },
  async handler(args, ctx) {
    if (typeof args.id !== "string") return fail("invalid_params", "`id` must be a string.");
    const content = await contentOr503(ctx);
    if (!content) return fail("content_unavailable", "Content storage is not available.");

    const source = await content.store.getForEdit(ctx.tenant.id, args.id, ctx.tenant.defaultLocale);
    if (!source) return fail("not_found", `No article with id '${args.id}'.`);

    const members = await content.store.listTranslations(ctx.tenant.id, source.articleKey ?? source.id);
    return ok({ articleKey: source.articleKey ?? source.id, members });
  },
};

export const getRoadmap: McpTool = {
  name: "get_roadmap",
  title: "Roadmap lesen",
  description:
    "Read the roadmap items of this help center, including their `sort` value. Pass that value back to upsert_roadmap_item to reorder — lower comes first.",
  scope: "articles:read",
  annotations: READ_ONLY,
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    // Bewusst die ADMIN-Sicht: der öffentliche Leser lässt `sort` weg, dann
    // kann ein Client zwar sortieren, das Ergebnis aber nicht nachlesen —
    // Umsortieren wird zum Raten (Migrations-Fund 2026-08-28).
    const store = await ctx.deps.getUpdatesStore?.();
    if (store) return ok({ items: await store.listRoadmap(ctx.tenant.id) });

    const content = await contentOr503(ctx);
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    return ok({ items: await content.store.roadmap(ctx.tenant.id) });
  },
};

export const getChangelog: McpTool = {
  name: "get_changelog",
  title: "Changelog lesen",
  description:
    "Read the changelog entries of this help center. Useful as a source for new or updated help articles.",
  scope: "articles:read",
  annotations: READ_ONLY,
  inputSchema: { type: "object", properties: { locale: { type: "string" } } },
  async handler(args, ctx) {
    const content = await contentOr503(ctx);
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    const locale = typeof args.locale === "string" ? args.locale : ctx.tenant.defaultLocale;
    return ok({ locale, entries: await content.store.changelog(ctx.tenant.id, locale) });
  },
};

/**
 * Die Bauanleitung für gültige Artikel. Wird aus denselben Konstanten gespeist,
 * gegen die `validate.ts` prüft — ein Limit kann hier nicht veralten, ohne dass
 * der Drift-Test (conventions.test.ts) es merkt.
 */
export const getContentConventions: McpTool = {
  name: "get_content_conventions",
  title: "Schreib-Konventionen",
  description:
    "Read the content model of this help center: block types, field limits, slug rules and language. ALWAYS call this before creating or updating an article — the article body is a typed block list, not markdown.",
  scope: "articles:read",
  annotations: READ_ONLY,
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    return ok({
      locale: {
        default: ctx.tenant.defaultLocale,
        note: "Write in the help center's default locale unless the user asks otherwise.",
      },
      slug: {
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
        maxLength: MAX_SLUG_LENGTH,
        reserved: [...RESERVED_SLUGS],
        note: "Lowercase, hyphen-separated. Must be unique per locale; a duplicate returns slug_conflict.",
      },
      limits: {
        titleMaxChars: MAX_TITLE_LENGTH,
        categoryMaxChars: MAX_CATEGORY_LENGTH,
        maxBodyBlocks: MAX_BODY_BLOCKS,
      },
      body: {
        note: "The body is an ARRAY OF BLOCKS. A plain string is accepted and treated as a standard text block.",
        blocks: [
          {
            type: "text",
            shape: { type: "text", variant: "standard", text: "..." },
            variants: [...TEXT_VARIANTS],
            note: "variant 'info' | 'warning' | 'error' render as callouts, 'code' as a code block.",
          },
          {
            type: "table",
            shape: { type: "table", head: ["Feld", "Bedeutung"], rows: [["a", "b"]] },
            note: "head may be empty; rows should share the same length.",
          },
          {
            type: "image",
            shape: { type: "image", imageId: "<id returned by add_image_from_url>" },
            note: "An image must exist on the article before a block can reference it. Order: create_article (or update_article) → add_image_from_url with a real description of what the image shows → update_article to place the block. A block pointing at an unknown id renders as nothing.",
          },
          {
            type: "video",
            shape: { type: "video", videoId: "<id of a video on this article>" },
            note: "Videos live in the article's `videos` list (set it with update_article): { id, title, description, youtubeId }. YouTube only. `description` is required and is what the AI search reads.",
          },
          {
            type: "articleLink",
            shape: {
              type: "articleLink",
              slug: "other-article",
              title: "...",
              description: "...",
              tag: { text: "Neu", color: "brand" },
            },
            tagColors: [...TAG_COLORS],
            note: "A single full-width card. For a SET of links use articleLinks instead.",
          },
          {
            type: "articleLinks",
            shape: {
              type: "articleLinks",
              items: [
                { slug: "first-article", title: "...", description: "...", tag: null },
                { slug: "second-article", title: "...", description: "...", tag: null },
              ],
            },
            note: `A grid of link cards side by side — use this for sections that are pure navigation ("More features", "Related integrations"), which is how most help centers end an article. 1 to ${MAX_LINK_CARDS} items; every slug must be an article that exists in this help center.`,
          },
        ],
      },
      lifecycle: {
        note: "Articles created through this server always start as drafts. Publishing is a separate tool and a separate permission.",
      },
    });
  },
};

/**
 * „Was darf dieser Schlüssel?" — beantwortet dem Modell die Frage, bevor es
 * gegen eine Wand läuft, und macht die Grenze im Chat für den Menschen
 * sichtbar. Bewusst ohne Scope-Anforderung (s. registry.ts).
 */
export const getPermissions: McpTool = {
  name: "get_permissions",
  title: "Berechtigungen anzeigen",
  description:
    "Show what this access key is allowed to do. Call this first if a tool is missing — the key may simply not have that permission.",
  scope: "articles:read",
  annotations: READ_ONLY,
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    return ok({
      keyName: ctx.principal.name,
      helpCenter: { name: ctx.tenant.name, defaultLocale: ctx.tenant.defaultLocale },
      grants: ctx.principal.scopes.map((scope) => ({
        scope,
        level: scopeDef(scope).tier,
        meaning: API_SCOPES[scope].summary,
      })),
      notGranted: (Object.keys(API_SCOPES) as (keyof typeof API_SCOPES)[])
        .filter((s) => !ctx.principal.scopes.includes(s))
        .map((scope) => ({ scope, meaning: API_SCOPES[scope].summary })),
      note: "Permissions are set by a human in the help center admin area. Ask the user to adjust the key there if something is missing.",
    });
  },
};

export const READ_TOOLS: McpTool[] = [
  getPermissions,
  getContentConventions,
  listArticles,
  getArticle,
  searchArticles,
  listCategories,
  listTranslations,
  getRoadmap,
  getChangelog,
];
