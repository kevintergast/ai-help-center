import { readPlanState } from "@/server/billing/store";
import { fail, ok, type McpTool, type ToolContext } from "./types";

/**
 * ZERSTÖRENDE WERKZEUGE (Stufe 4 rot) — Löschen NUR mit Bestätigung.
 *
 * ANFORDERUNG (Kevin, 2026-08-22): „bei der KI bestätigen müssen, wenn ein
 * Artikel gelöscht werden soll." Umgesetzt als ZWEI-SCHRITT-VERFAHREN:
 *
 *   1. Aufruf OHNE Token  → es wird NICHTS gelöscht. Zurück kommt eine
 *      Zusammenfassung dessen, was verschwinden würde (Titel, Slug, Status,
 *      Bilder, Sprachfassungen) plus ein kurzlebiges Bestätigungs-Token.
 *   2. Aufruf MIT Token   → gelöscht wird erst jetzt.
 *
 * Warum ein Token und nicht bloß ein `confirm: true`-Flag? Ein Flag kann das
 * Modell selbst setzen — dann wäre die „Bestätigung" eine Formalie, die die KI
 * mit sich selbst aushandelt. Das Token wird serverseitig signiert, ist an
 * Mandant, Schlüssel, Artikel UND dessen aktuellen Zustand gebunden, lebt fünf
 * Minuten und funktioniert genau einmal. Der Zwischenschritt zwingt das Modell,
 * dem Menschen zu zeigen, was auf dem Spiel steht — und der Mensch sagt ja.
 *
 * Zusätzlich trägt das Werkzeug `destructiveHint`, sodass viele Clients von
 * sich aus einen Bestätigungsdialog zeigen. Das ist Komfort obendrauf; die
 * Garantie ist das Token.
 */

/** Ohne Änderung am Artikel bleibt der Fingerabdruck gleich — sonst verfällt das Token. */
function fingerprintOf(article: {
  title: string;
  slug: string;
  status: string;
  body: unknown[];
}): string {
  return `${article.slug}|${article.title}|${article.status}|${article.body.length}`;
}

async function frozen(ctx: ToolContext): Promise<boolean> {
  const billing = await ctx.deps.getBillingDeps?.();
  if (!billing) return false;
  const state = await readPlanState(billing.repo, ctx.tenant.id, ctx.nowSec);
  return state.status === "frozen";
}

export const deleteArticle: McpTool = {
  name: "delete_article",
  title: "Artikel löschen",
  description:
    "Permanently delete an article including all its versions and images. TWO STEPS: call without `confirmation_token` first — you get a summary of what would be deleted and a token. Show that summary to the user, ask for an explicit yes, and only then call again with the token. Deletion cannot be undone. Consider unpublish_article instead if the goal is just to hide the article.",
  scope: "articles:delete",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Article id." },
      confirmation_token: {
        type: "string",
        description:
          "Token from the first call. Only pass it after the user has explicitly confirmed the deletion.",
      },
    },
    required: ["id"],
  },
  async handler(args, ctx) {
    if (typeof args.id !== "string") return fail("invalid_params", "`id` must be a string.");
    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) {
      return fail("payment_required", "This help center is frozen; content changes are blocked.");
    }

    const article = await content.store.getForEdit(ctx.tenant.id, args.id, ctx.tenant.defaultLocale);
    if (!article) return fail("not_found", `No article with id '${args.id}'.`);

    const subject = {
      tenantId: ctx.tenant.id,
      keyId: ctx.principal.keyId,
      action: "delete_article",
      targetId: args.id,
      fingerprint: fingerprintOf(article),
    };

    // ── Schritt 1: beschreiben, nicht löschen ──────────────────────────────
    if (typeof args.confirmation_token !== "string" || args.confirmation_token.length === 0) {
      const translations = await content.store.listTranslations(
        ctx.tenant.id,
        article.articleKey ?? article.id,
      );
      return ok({
        status: "confirmation_required",
        confirmation_token: await ctx.confirmations.issue(subject),
        expiresInSeconds: 300,
        wouldDelete: {
          id: article.id,
          title: article.title,
          slug: article.slug,
          category: article.category,
          status: article.status,
          blocks: article.body.length,
          images: article.images?.length ?? 0,
          videos: article.videos?.length ?? 0,
          otherLanguageVersions: translations.filter((t) => t.id !== article.id).length,
        },
        instruction:
          "Nothing has been deleted. Show the user exactly what would be deleted, ask for an explicit confirmation, and only then call delete_article again with this confirmation_token. If the user only wants to hide the article, use unpublish_article instead.",
      });
    }

    // ── Schritt 2: Token prüfen und verbrauchen ────────────────────────────
    const valid = await ctx.confirmations.consume(args.confirmation_token, subject);
    if (!valid) {
      return fail(
        "invalid_confirmation",
        "This confirmation token is invalid, expired, already used, or the article changed in the meantime. Call delete_article without a token again and re-confirm with the user.",
      );
    }

    const removed = await content.store.remove(ctx.tenant.id, args.id);
    if (!removed) return fail("not_found", `No article with id '${args.id}'.`);

    try {
      const indexer = await ctx.deps.getContentIndexer?.();
      await indexer?.onContentChange(ctx.tenant.id, args.id);
    } catch (err) {
      console.error("[mcp] Index-Sync nach Löschung fehlgeschlagen (ignoriert):", err);
    }

    try {
      const team = await ctx.deps.getTeamDeps();
      await team?.audit.append({
        tenantId: ctx.tenant.id,
        actorId: null,
        action: "mcp.article.deleted",
        targetId: args.id,
        metadata: {
          keyId: ctx.principal.keyId,
          keyName: ctx.principal.name,
          slug: article.slug,
          title: article.title,
        },
      });
    } catch (err) {
      console.error("[mcp] Audit fehlgeschlagen (ignoriert):", err);
    }

    return ok({
      id: args.id,
      deleted: true,
      title: article.title,
      note: "The article and its versions are gone. This cannot be undone.",
    });
  },
};

export const DESTRUCTIVE_TOOLS: McpTool[] = [deleteArticle];
