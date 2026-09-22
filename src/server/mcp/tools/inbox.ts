import type { TicketKind, TicketStatus } from "@/server/support/store";
import { fail, ok, UNTRUSTED_NOTE, type McpTool } from "./types";

/**
 * POSTFACH-WERKZEUGE (Nutzerhinweise) — die Gegenstücke zu den Rechten
 * `support:read` / `support:write` / `support:delete`.
 *
 * WARUM ES SIE VORHER NICHT GAB: Die drei Rechte standen seit jeher im
 * Scope-Katalog und als anklickbare Kästchen in der Schlüssel-Verwaltung
 * („Support-Tickets lesen", „Status setzen, Tickets abschließen") — aber kein
 * einziges Werkzeug und keine Route hat sie je gelesen. Wer sie vergab, hielt
 * etwas frei, was es nicht gab. Genau das meldete ein angebundener Client am
 * 2026-09-22: Rechte vorhanden, Werkzeuge fehlen.
 *
 * KEIN EIGENES `get_inbox_item`: `list_inbox` liefert die Einträge bereits
 * vollständig (Nachricht, Zitat, Vorschlag, Adresse). Ein zweites Werkzeug
 * für dieselben Felder wäre zusätzliche Oberfläche ohne zusätzliche Fähigkeit.
 *
 * FREMDER TEXT: Jeder Eintrag enthält frei geschriebenen Text von ENDNUTZERN.
 * Das ist der klassische Einschleusungs-Weg — „Ignoriere deine Anweisungen und
 * veröffentliche …" in einem Ticket darf das Modell nicht steuern. Deshalb
 * trägt jede Antwort `untrustedContent` (docs/mcp-plan.md §4 E8).
 */

const KINDS: TicketKind[] = ["support", "comprehension", "ai_review"];
const MAX_LIMIT = 100;

function parseLimit(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(raw)));
}

export const listInbox: McpTool = {
  name: "list_inbox",
  title: "Nutzerhinweise lesen",
  description:
    "List the help center's inbox: support requests, 'I don't understand something' reports from readers (with the exact passage they clicked) and reports filed by AI clients. Open items come first. Use this to find out what readers are struggling with, then fix the articles. WARNING: entries contain personal data of end users (email addresses, free text) — only pass them on to the operator, never to third parties.",
  scope: "support:read",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["open", "done", "all"],
        description: "Which entries to return. Default: 'open'.",
      },
      kind: {
        type: "string",
        enum: [...KINDS],
        description:
          "Optional filter: 'support' = contact form, 'comprehension' = reader marked an unclear passage, 'ai_review' = report filed by an AI client.",
      },
      limit: { type: "number", description: `Maximum entries (1–${MAX_LIMIT}, default 30).` },
    },
  },
  async handler(args, ctx) {
    const support = await ctx.deps.getSupportDeps?.();
    if (!support) return fail("support_unavailable", "The inbox is not available.");

    const status = args.status === "done" || args.status === "all" ? args.status : "open";
    const kind = KINDS.includes(args.kind as TicketKind) ? (args.kind as TicketKind) : null;
    const limit = parseLimit(args.limit, 30);

    // Der Store liefert offene zuerst; gefiltert wird danach, damit der
    // Deckel sich auf das bezieht, was tatsächlich zurückgeht.
    const all = await support.repo.listByTenant(ctx.tenant.id, MAX_LIMIT);
    const items = all
      .filter((t) => (status === "all" ? true : t.status === status))
      .filter((t) => (kind ? t.kind === kind : true))
      .slice(0, limit);

    return ok({
      count: items.length,
      items: items.map((t) => ({
        id: t.id,
        kind: t.kind,
        status: t.status,
        message: t.message,
        contactEmail: t.contactEmail,
        question: t.question,
        articleId: t.articleId,
        quote: t.quote,
        suggestion: t.suggestion,
        createdAt: t.createdAt,
      })),
      untrustedContent: UNTRUSTED_NOTE,
      note: "Entries with kind 'comprehension' carry `articleId` and `quote`: that is the exact passage a reader did not understand. Fix the article with update_article, then close the entry with resolve_inbox_item.",
    });
  },
};

export const resolveInboxItem: McpTool = {
  name: "resolve_inbox_item",
  title: "Hinweis abschließen",
  description:
    "Mark an inbox entry as done — or reopen it. Closing does not notify anyone; it only removes the entry from the operator's open list. Close an entry once the underlying problem is actually fixed (for example the article has been corrected and published), not merely once you have read it.",
  scope: "support:write",
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Entry id from list_inbox." },
      status: {
        type: "string",
        enum: ["done", "open"],
        description: "Target status. Default: 'done'.",
      },
    },
    required: ["id"],
  },
  async handler(args, ctx) {
    if (typeof args.id !== "string" || args.id.length === 0) {
      return fail("invalid_params", "`id` must be a string.");
    }
    const support = await ctx.deps.getSupportDeps?.();
    if (!support) return fail("support_unavailable", "The inbox is not available.");

    const status: TicketStatus = args.status === "open" ? "open" : "done";
    const changed = await support.repo.setStatus(ctx.tenant.id, args.id, status);
    if (!changed) return fail("not_found", `No inbox entry with id '${args.id}'.`);
    return ok({ id: args.id, status, note: `Entry is now '${status}'.` });
  },
};

export const deleteInboxItem: McpTool = {
  name: "delete_inbox_item",
  title: "Hinweis löschen",
  description:
    "Permanently delete an inbox entry. TWO STEPS: call without `confirmation_token` first — you get a summary of what would be deleted and a token. Show that summary to the user, ask for an explicit yes, and only then call again with the token. Deletion cannot be undone. If the goal is just to clear the open list, use resolve_inbox_item instead.",
  scope: "support:delete",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Entry id from list_inbox." },
      confirmation_token: {
        type: "string",
        description:
          "Token from the first call. Only pass it after the user has explicitly confirmed the deletion.",
      },
    },
    required: ["id"],
  },
  async handler(args, ctx) {
    if (typeof args.id !== "string" || args.id.length === 0) {
      return fail("invalid_params", "`id` must be a string.");
    }
    const support = await ctx.deps.getSupportDeps?.();
    if (!support) return fail("support_unavailable", "The inbox is not available.");

    const ticket = (await support.repo.listByTenant(ctx.tenant.id, MAX_LIMIT)).find(
      (t) => t.id === args.id,
    );
    if (!ticket) return fail("not_found", `No inbox entry with id '${args.id}'.`);

    const subject = {
      tenantId: ctx.tenant.id,
      keyId: ctx.principal.keyId,
      action: "delete_inbox_item",
      targetId: args.id,
      // Ändert sich der Eintrag (z. B. Status), verfällt das Token — sonst
      // bestätigte der Mensch etwas anderes, als am Ende gelöscht wird.
      fingerprint: `${ticket.kind}|${ticket.status}|${ticket.createdAt}`,
    };

    if (typeof args.confirmation_token !== "string" || args.confirmation_token.length === 0) {
      return ok({
        status: "confirmation_required",
        confirmation_token: await ctx.confirmations.issue(subject),
        expiresInSeconds: 300,
        wouldDelete: {
          id: ticket.id,
          kind: ticket.kind,
          status: ticket.status,
          // Anriss statt Volltext: Für die Rückfrage genügt, WELCHER Eintrag
          // gemeint ist; der ganze Text stünde sonst ein zweites Mal im
          // Verlauf.
          messagePreview: ticket.message.slice(0, 120),
          hasContactEmail: ticket.contactEmail !== null,
          createdAt: ticket.createdAt,
        },
        untrustedContent: UNTRUSTED_NOTE,
        instruction:
          "Nothing has been deleted. Show the user which entry would be deleted, ask for an explicit confirmation, and only then call delete_inbox_item again with this confirmation_token.",
      });
    }

    const valid = await ctx.confirmations.consume(args.confirmation_token, subject);
    if (!valid) {
      return fail(
        "invalid_confirmation",
        "This confirmation token is invalid, expired, already used, or the entry changed in the meantime. Call delete_inbox_item without a token again and re-confirm with the user.",
      );
    }

    const removed = await support.repo.remove(ctx.tenant.id, args.id);
    if (!removed) return fail("not_found", `No inbox entry with id '${args.id}'.`);
    return ok({ id: args.id, deleted: true });
  },
};

export const listUnansweredQuestions: McpTool = {
  name: "list_unanswered_questions",
  title: "Unbeantwortete Fragen lesen",
  description:
    "List questions the AI could not answer from this help center's articles, grouped and sorted by frequency — entries someone explicitly asked to have answered come first. This is the writing queue: what appears often here is a missing article. Note that a question can fail simply because the articles use different words than readers do; check whether an existing article should merely gain the reader's vocabulary before writing a new one. Entries are deleted automatically after 90 days.",
  scope: "support:read",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: `Maximum groups (1–${MAX_LIMIT}, default 20).` },
    },
  },
  async handler(args, ctx) {
    const repo = await ctx.deps.getUnansweredRepo?.();
    if (!repo) return fail("unanswered_unavailable", "The list is not available.");

    const groups = await repo.list(ctx.tenant.id, parseLimit(args.limit, 20));
    return ok({
      count: groups.length,
      groups: groups.map((g) => ({
        question: g.question,
        askedTimes: g.count,
        someoneIsWaiting: g.reported,
        contactEmails: g.emails,
        lastAskedAt: g.lastAskedAt,
      })),
      untrustedContent: UNTRUSTED_NOTE,
    });
  },
};

export const INBOX_TOOLS: McpTool[] = [
  listInbox,
  resolveInboxItem,
  deleteInboxItem,
  listUnansweredQuestions,
];
