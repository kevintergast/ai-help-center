import { readPlanState } from "@/server/billing/store";
import { validateChangelogInput, validateRoadmapInput } from "@/server/content/updates";
import { fail, ok, type McpTool, type ToolContext } from "./types";

/**
 * PRODUKT-UPDATES per MCP: Changelog-Einträge und Roadmap-Punkte pflegen.
 *
 * WARUM EIGENER SCOPE (`updates:write`, Stufe „public"): Anders als Artikel
 * haben diese Inhalte KEINEN Entwurfszustand — ein angelegter Changelog-Eintrag
 * steht sofort im Hilfezentrum. Das ist kein Versehen, sondern das Wesen einer
 * Mitteilung; deshalb darf `articles:write` (ausdrücklich „kann nicht
 * veröffentlichen") das hier nicht können.
 *
 * DIESELBE VALIDIERUNG wie die REST-API (`content/updates.ts`) — der MCP-Server
 * ist eine zweite Tür zum selben Haus, kein zweites Regelwerk.
 *
 * LÖSCHEN NUR MIT BESTÄTIGUNG: gleiches Zwei-Schritt-Verfahren wie bei
 * `delete_article` (Token statt Flag, damit die KI die Bestätigung nicht mit
 * sich selbst aushandelt) — siehe destructive.ts.
 */

const WRITE_HINTS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;
const DELETE_HINTS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false } as const;

async function frozen(ctx: ToolContext): Promise<boolean> {
  const billing = await ctx.deps.getBillingDeps?.();
  if (!billing) return false;
  const state = await readPlanState(billing.repo, ctx.tenant.id, ctx.nowSec);
  return state.status === "frozen";
}

const FROZEN = () =>
  fail("payment_required", "This help center is frozen; content changes are blocked.");

async function storeOf(ctx: ToolContext) {
  return (await ctx.deps.getUpdatesStore?.()) ?? null;
}

/** Reindex nach jeder Mutation (Changelog/Roadmap sind RAG-Pseudo-Dokumente). */
async function reindex(ctx: ToolContext): Promise<void> {
  try {
    const indexer = await ctx.deps.getContentIndexer?.();
    await indexer?.rebuildTenant(ctx.tenant.id);
  } catch (err) {
    console.error("[mcp] Reindex nach Update-Änderung fehlgeschlagen (ignoriert):", err);
  }
}

const VERSION_FIELD = {
  type: "string",
  description:
    "Version number of the customer's OWN product, free text (e.g. '2.4.0', 'R25-08', 'Spring 2026'). Optional — omit if this help center does not track versions.",
} as const;

const LEVEL_FIELD = {
  type: "string",
  enum: ["major", "minor", "patch"],
  description:
    "Kind of update, shown as a badge to readers ('Major update' / 'New features' / 'Improvements'). Optional.",
} as const;

export const createChangelogEntry: McpTool = {
  name: "create_changelog_entry",
  title: "Changelog-Eintrag anlegen",
  description:
    "Add an entry to the public changelog of this help center. WARNING: changelog entries have no draft state — the entry is visible to end users immediately. Optionally carries a version number and an update level. Set `published_at` to a future timestamp to date the entry forward.",
  scope: "updates:write",
  annotations: WRITE_HINTS,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short headline of the change." },
      description: { type: "string", description: "What changed, in the reader's language." },
      version: VERSION_FIELD,
      level: LEVEL_FIELD,
      published_at: {
        type: "number",
        description: "Unix seconds. Defaults to now; entries are ordered by this value.",
      },
    },
    required: ["title"],
  },
  async handler(args, ctx) {
    const store = await storeOf(ctx);
    if (!store) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN();

    const parsed = validateChangelogInput({
      title: args.title,
      description: args.description ?? "",
      version: args.version,
      level: args.level,
      publishedAt: args.published_at,
    });
    if (!parsed.ok) return fail("invalid_params", `Invalid input: ${parsed.error}.`);

    const entry = await store.createChangelog(ctx.tenant.id, parsed.value, ctx.nowSec);
    await reindex(ctx);
    return ok({ status: "created", entry, note: "This entry is now publicly visible." });
  },
};

export const updateChangelogEntry: McpTool = {
  name: "update_changelog_entry",
  title: "Changelog-Eintrag ändern",
  description:
    "Replace title, description, version and level of an existing changelog entry. All fields are overwritten — read the entry with get_changelog first and pass the values you want to keep. Omitting `published_at` keeps the original date.",
  scope: "updates:write",
  annotations: { ...WRITE_HINTS, idempotentHint: true },
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Entry id (see get_changelog)." },
      title: { type: "string" },
      description: { type: "string" },
      version: VERSION_FIELD,
      level: LEVEL_FIELD,
      published_at: { type: "number", description: "Unix seconds; omit to keep the current date." },
    },
    required: ["id", "title"],
  },
  async handler(args, ctx) {
    if (typeof args.id !== "string") return fail("invalid_params", "`id` must be a string.");
    const store = await storeOf(ctx);
    if (!store) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN();

    const parsed = validateChangelogInput({
      title: args.title,
      description: args.description ?? "",
      version: args.version,
      level: args.level,
      publishedAt: args.published_at,
    });
    if (!parsed.ok) return fail("invalid_params", `Invalid input: ${parsed.error}.`);

    const entry = await store.updateChangelog(ctx.tenant.id, args.id, parsed.value);
    if (!entry) return fail("not_found", `No changelog entry with id '${args.id}'.`);
    await reindex(ctx);
    return ok({ status: "updated", entry });
  },
};

export const deleteChangelogEntry: McpTool = {
  name: "delete_changelog_entry",
  title: "Changelog-Eintrag löschen",
  description:
    "Permanently remove a changelog entry. TWO STEPS: call without `confirmation_token` first — you get a summary plus a token. Show it to the user, ask for an explicit yes, then call again with the token.",
  scope: "updates:write",
  annotations: DELETE_HINTS,
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      confirmation_token: { type: "string", description: "Token from the first call." },
    },
    required: ["id"],
  },
  async handler(args, ctx) {
    if (typeof args.id !== "string") return fail("invalid_params", "`id` must be a string.");
    const store = await storeOf(ctx);
    if (!store) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN();

    const entries = await store.listChangelog(ctx.tenant.id);
    const entry = entries.find((e) => e.id === args.id);
    if (!entry) return fail("not_found", `No changelog entry with id '${args.id}'.`);

    const subject = {
      tenantId: ctx.tenant.id,
      keyId: ctx.principal.keyId,
      action: "delete_changelog_entry",
      targetId: args.id,
      // Ändert sich der Eintrag zwischen den Schritten, verfällt das Token.
      fingerprint: `${entry.title}|${entry.version ?? ""}|${entry.publishedAt}`,
    };

    if (typeof args.confirmation_token !== "string" || args.confirmation_token.length === 0) {
      return ok({
        status: "confirmation_required",
        confirmation_token: await ctx.confirmations.issue(subject),
        expiresInSeconds: 300,
        wouldDelete: {
          id: entry.id,
          title: entry.title,
          version: entry.version,
          level: entry.level,
          date: entry.dateLabel,
        },
        instruction:
          "Nothing has been deleted. Show the user what would disappear from the public changelog, ask for an explicit confirmation, then call delete_changelog_entry again with this token.",
      });
    }

    const valid = await ctx.confirmations.consume(args.confirmation_token, subject);
    if (!valid) {
      return fail(
        "invalid_confirmation",
        "This confirmation token is invalid, expired, already used, or the entry changed. Call again without a token and re-confirm with the user.",
      );
    }

    const removed = await store.deleteChangelog(ctx.tenant.id, args.id);
    if (!removed) return fail("not_found", `No changelog entry with id '${args.id}'.`);
    await reindex(ctx);
    return ok({ status: "deleted", id: args.id });
  },
};

export const upsertRoadmapItem: McpTool = {
  name: "upsert_roadmap_item",
  title: "Roadmap-Punkt anlegen oder ändern",
  description:
    "Create a roadmap item or update an existing one (pass `id` to update). Roadmap items are publicly visible. Status is one of requested / planned / in_progress / shipped — use `requested` for a customer wish you have NOT committed to yet; `sort` controls the order (lower first, new items go to the end).",
  scope: "updates:write",
  annotations: WRITE_HINTS,
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Omit to create, pass to update (see get_roadmap)." },
      title: { type: "string" },
      status: { type: "string", enum: ["requested", "planned", "in_progress", "shipped"] },
      sort: { type: "number", description: "Lower values appear first." },
    },
    required: ["title"],
  },
  async handler(args, ctx) {
    const store = await storeOf(ctx);
    if (!store) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN();

    const parsed = validateRoadmapInput({
      title: args.title,
      status: args.status,
      sort: args.sort,
    });
    if (!parsed.ok) return fail("invalid_params", `Invalid input: ${parsed.error}.`);

    if (typeof args.id === "string" && args.id.length > 0) {
      const item = await store.updateRoadmap(ctx.tenant.id, args.id, parsed.value);
      if (!item) return fail("not_found", `No roadmap item with id '${args.id}'.`);
      await reindex(ctx);
      return ok({ status: "updated", item });
    }
    const item = await store.createRoadmap(ctx.tenant.id, parsed.value);
    await reindex(ctx);
    return ok({ status: "created", item, note: "This item is now publicly visible." });
  },
};

export const deleteRoadmapItem: McpTool = {
  name: "delete_roadmap_item",
  title: "Roadmap-Punkt löschen",
  description:
    "Permanently remove a roadmap item. TWO STEPS: call without `confirmation_token` first, show the summary to the user, then call again with the token.",
  scope: "updates:write",
  annotations: DELETE_HINTS,
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      confirmation_token: { type: "string" },
    },
    required: ["id"],
  },
  async handler(args, ctx) {
    if (typeof args.id !== "string") return fail("invalid_params", "`id` must be a string.");
    const store = await storeOf(ctx);
    if (!store) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN();

    const items = await store.listRoadmap(ctx.tenant.id);
    const item = items.find((i) => i.id === args.id);
    if (!item) return fail("not_found", `No roadmap item with id '${args.id}'.`);

    const subject = {
      tenantId: ctx.tenant.id,
      keyId: ctx.principal.keyId,
      action: "delete_roadmap_item",
      targetId: args.id,
      fingerprint: `${item.title}|${item.status}`,
    };

    if (typeof args.confirmation_token !== "string" || args.confirmation_token.length === 0) {
      return ok({
        status: "confirmation_required",
        confirmation_token: await ctx.confirmations.issue(subject),
        expiresInSeconds: 300,
        wouldDelete: { id: item.id, title: item.title, status: item.status },
        instruction:
          "Nothing has been deleted. Show the user which roadmap item would disappear, ask for an explicit confirmation, then call again with this token.",
      });
    }

    const valid = await ctx.confirmations.consume(args.confirmation_token, subject);
    if (!valid) {
      return fail(
        "invalid_confirmation",
        "This confirmation token is invalid, expired, already used, or the item changed. Call again without a token and re-confirm with the user.",
      );
    }

    const removed = await store.deleteRoadmap(ctx.tenant.id, args.id);
    if (!removed) return fail("not_found", `No roadmap item with id '${args.id}'.`);
    await reindex(ctx);
    return ok({ status: "deleted", id: args.id });
  },
};

export const UPDATE_TOOLS: McpTool[] = [
  createChangelogEntry,
  updateChangelogEntry,
  deleteChangelogEntry,
  upsertRoadmapItem,
  deleteRoadmapItem,
];
