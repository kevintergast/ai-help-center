import { readPlanState } from "@/server/billing/store";
import {
  MAX_ENTRY_CARDS,
  parseEntryCardInput,
  type EntryCard,
} from "@/lib/content/entry-cards";
import {
  CONTACT_KINDS,
  MAX_CONTACT_METHODS,
  parseContactMethodInput,
  type ContactMethod,
} from "@/lib/content/contact-methods";
import { fail, ok, type McpTool, type ToolContext } from "./types";

/**
 * NAVIGATIONS-WERKZEUGE — Reihenfolge der Leiste (0034), Einstiegs-Karten der
 * Startansicht (0035) und Kontaktwege der Seite `/contact` (0037).
 *
 * BEIDE WIRKEN SOFORT ÖFFENTLICH. Es gibt hier keinen Entwurfszustand: Wer die
 * Reihenfolge ändert, ändert, was der nächste Besucher sieht. Deshalb liegen
 * die Schreib-Werkzeuge NICHT auf `articles:write` (dessen Zusage lautet
 * ausdrücklich „bleibt ein Entwurf"), sondern auf den Scopes der orangen
 * Stufe — `articles:publish` für die Artikel-Reihenfolge, `updates:write` für
 * die Karten (wie Changelog/Roadmap, die ebenfalls ohne Entwurf leben).
 *
 * ERGONOMIE-ENTSCHEIDUNG: `set_entry_cards` und `set_contact_methods` ersetzen
 * den GANZEN Satz, statt vier Werkzeuge für anlegen/ändern/löschen/sortieren
 * anzubieten. Bei höchstens sechs Karten ist „hier ist der neue Stand" für ein
 * Modell fehlerfrei zu treffen; Id-Jonglage über mehrere Aufrufe ist es nicht.
 */

const PUBLIC_HINTS = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;

async function frozen(ctx: ToolContext): Promise<boolean> {
  const billing = await ctx.deps.getBillingDeps?.();
  if (!billing) return false;
  const state = await readPlanState(billing.repo, ctx.tenant.id, ctx.nowSec);
  return state.status === "frozen";
}

const FROZEN_RESULT = () =>
  fail(
    "plan_frozen",
    "This help center is frozen because of an overdue plan. Content changes are blocked until billing is settled.",
  );

export const reorderArticles: McpTool = {
  name: "reorder_articles",
  title: "Artikel-Reihenfolge setzen",
  description:
    "Set the order of articles in the help center's left navigation. Pass slugs (or ids) in the order you want them to appear. The list does NOT have to be complete: articles you name move to the front in that order, all others keep their current relative order behind them. Categories inherit their position from their first article, so this one call orders both articles and categories. Takes effect immediately for end users.",
  scope: "articles:publish",
  annotations: PUBLIC_HINTS,
  inputSchema: {
    type: "object",
    properties: {
      order: {
        type: "array",
        description:
          "Article slugs or ids, first one appears at the top. Unknown entries are ignored. Group articles of the same category together — a category's position comes from its first article.",
        items: { type: "string" },
      },
    },
    required: ["order"],
  },
  async handler(args, ctx) {
    if (!Array.isArray(args.order)) return fail("invalid_params", "`order` must be an array.");
    const wanted = args.order.filter((v): v is string => typeof v === "string");
    if (wanted.length !== args.order.length) {
      return fail("invalid_params", "`order` must contain only strings.");
    }

    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    const locale = ctx.tenant.defaultLocale;
    const current = await content.store.listOrderable(ctx.tenant.id, locale);

    // Slugs sind der natürliche Griff für ein Modell (es kennt sie aus
    // list_articles); Ids bleiben erlaubt, damit beide Türen dieselbe Sprache
    // sprechen. Aufgelöst wird hier, damit der Store nur Ids sieht.
    const idBySlug = new Map(current.map((a) => [a.slug, a.id]));
    const knownIds = new Set(current.map((a) => a.id));
    const ids: string[] = [];
    const unknown: string[] = [];
    for (const entry of wanted) {
      const id = idBySlug.get(entry) ?? (knownIds.has(entry) ? entry : null);
      if (id) ids.push(id);
      else unknown.push(entry);
    }

    if (ids.length === 0) {
      return fail(
        "not_found",
        "None of the given entries matched an article in this help center. Use list_articles to get the slugs.",
      );
    }

    await content.store.reorderArticles(ctx.tenant.id, locale, ids);
    const after = await content.store.listOrderable(ctx.tenant.id, locale);
    return ok({
      ordered: ids.length,
      ignored: unknown,
      order: after.map((a) => ({ slug: a.slug, title: a.title, category: a.category })),
    });
  },
};

export const listEntryCards: McpTool = {
  name: "list_entry_cards",
  title: "Einstiegs-Karten lesen",
  description:
    "Read the entry cards shown under the AI input on the help center's start page. Call this before set_entry_cards so you know what is already there.",
  scope: "articles:read",
  annotations: { readOnlyHint: true },
  async handler(_args, ctx) {
    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    const cards = await content.store.listEntryCards(ctx.tenant.id);
    return ok({ cards, max: MAX_ENTRY_CARDS });
  },
  inputSchema: { type: "object", properties: {} },
};

export const setEntryCards: McpTool = {
  name: "set_entry_cards",
  title: "Einstiegs-Karten setzen",
  description:
    `REPLACES all entry cards under the AI input on the start page with the list you pass, in that order. Pass an empty array to remove them all. At most ${MAX_ENTRY_CARDS} cards. These are visible to end users immediately — there is no draft state. Read list_entry_cards first if you only want to change one card.`,
  scope: "updates:write",
  annotations: PUBLIC_HINTS,
  inputSchema: {
    type: "object",
    properties: {
      cards: {
        type: "array",
        maxItems: MAX_ENTRY_CARDS,
        description: "The complete new set of cards, top-left first.",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["article", "roadmap", "changelog", "url"],
              description:
                "article = link to one of your articles (target = its slug); roadmap / changelog = open that view (no target); url = external https address (target = the URL).",
            },
            title: { type: "string", description: "Card headline, max 80 characters." },
            description: {
              type: "string",
              description: "One short line under the title, max 160 characters. Optional.",
            },
            target: {
              type: "string",
              description:
                "Article slug for kind=article, https URL for kind=url. Leave empty for roadmap and changelog.",
            },
          },
          required: ["kind", "title"],
        },
      },
    },
    required: ["cards"],
  },
  async handler(args, ctx) {
    if (!Array.isArray(args.cards)) return fail("invalid_params", "`cards` must be an array.");
    if (args.cards.length > MAX_ENTRY_CARDS) {
      return fail(
        "too_many_cards",
        `At most ${MAX_ENTRY_CARDS} entry cards are allowed; ${args.cards.length} were given.`,
      );
    }

    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    // ALLE Karten zuerst prüfen, dann schreiben: Ein halb ersetzter Satz wäre
    // auf der Startseite sichtbar, und zwar sofort.
    const parsed: Omit<EntryCard, "id">[] = [];
    for (let i = 0; i < args.cards.length; i += 1) {
      const res = parseEntryCardInput(args.cards[i]);
      if (!res.ok) {
        return fail(res.error, `Card ${i + 1} was rejected: ${res.error}. Nothing was changed.`);
      }
      parsed.push(res.card);
    }

    // Artikel-Karten dürfen nicht ins Leere zeigen: Ein Verweis auf einen
    // Entwurf oder einen Tippfehler-Slug ist für den Endnutzer ein toter Link.
    const articleTargets = parsed.filter((c) => c.kind === "article").map((c) => c.target);
    if (articleTargets.length > 0) {
      const published = await content.store.listPublishedArticles(
        ctx.tenant.id,
        ctx.tenant.defaultLocale,
      );
      const slugs = new Set(published.map((a) => a.slug));
      const missing = articleTargets.filter((slug) => !slugs.has(slug));
      if (missing.length > 0) {
        return fail(
          "article_not_found",
          `These slugs are not published articles in this help center: ${missing.join(", ")}. Nothing was changed.`,
          { missing },
        );
      }
    }

    const written = await content.store.replaceEntryCards(ctx.tenant.id, parsed);
    return ok({
      cards: written,
      note: "Entry cards are live on the start page now.",
    });
  },
};

export const listContactMethods: McpTool = {
  name: "list_contact_methods",
  title: "Kontaktwege lesen",
  description:
    "Read the contact options shown on the help center's contact page (/contact). Call this before set_contact_methods so you know what is already there.",
  scope: "articles:read",
  annotations: { readOnlyHint: true },
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    const methods = await content.store.listContactMethods(ctx.tenant.id);
    return ok({
      methods,
      max: MAX_CONTACT_METHODS,
      pageVisible: methods.length > 0,
      note:
        methods.length > 0
          ? "The contact page and its entry at the bottom of the navigation are visible."
          : "No contact option is set up, so /contact returns 404 and the navigation shows no contact entry.",
    });
  },
};

export const setContactMethods: McpTool = {
  name: "set_contact_methods",
  title: "Kontaktwege setzen",
  description:
    `REPLACES all contact options on the help center's contact page (/contact) with the list you pass, in that order. At most ${MAX_CONTACT_METHODS}. Pass an empty array to remove them all — the page and its navigation entry then disappear entirely. Visible to end users immediately; there is no draft state. IMPORTANT: only enter addresses and numbers the operator actually gave you. A wrong support address on the contact page reaches the people who are already stuck.`,
  scope: "updates:write",
  annotations: PUBLIC_HINTS,
  inputSchema: {
    type: "object",
    properties: {
      methods: {
        type: "array",
        maxItems: MAX_CONTACT_METHODS,
        description: "The complete new set of contact options, first one shown first.",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: [...CONTACT_KINDS],
              description:
                "email = address the reader can write to (value = the address); phone = number they can call (value = the number); form = a contact form right on the card, sending a ticket to the operator's inbox (no value needed).",
            },
            title: { type: "string", description: "Card heading, max 80 characters." },
            description: {
              type: "string",
              description:
                "One short line under the heading, max 200 characters. Good for expectations, e.g. \"Usually answered the same working day\".",
            },
            value: {
              type: "string",
              description:
                "Email address for kind=email, phone number for kind=phone (any common notation). Leave empty for kind=form.",
            },
          },
          required: ["kind", "title"],
        },
      },
    },
    required: ["methods"],
  },
  async handler(args, ctx) {
    if (!Array.isArray(args.methods)) return fail("invalid_params", "`methods` must be an array.");
    if (args.methods.length > MAX_CONTACT_METHODS) {
      return fail(
        "too_many_methods",
        `At most ${MAX_CONTACT_METHODS} contact options are allowed; ${args.methods.length} were given.`,
      );
    }

    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    // ALLE prüfen, bevor irgendetwas geschrieben wird: Ein halb ersetzter Satz
    // stünde sofort auf der Seite, die jemand aufruft, der nicht weiterkommt.
    const parsed: Omit<ContactMethod, "id">[] = [];
    for (let i = 0; i < args.methods.length; i += 1) {
      const res = parseContactMethodInput(args.methods[i]);
      if (!res.ok) {
        return fail(res.error, `Contact option ${i + 1} was rejected: ${res.error}. Nothing was changed.`);
      }
      parsed.push(res.method);
    }

    const written = await content.store.replaceContactMethods(ctx.tenant.id, parsed);
    return ok({
      methods: written,
      pageVisible: written > 0,
      note:
        written > 0
          ? "The contact page is live now and the navigation shows a contact entry."
          : "All contact options removed — /contact now returns 404 and the navigation entry is gone.",
    });
  },
};

export const NAVIGATION_TOOLS: McpTool[] = [
  reorderArticles,
  listEntryCards,
  setEntryCards,
  listContactMethods,
  setContactMethods,
];
