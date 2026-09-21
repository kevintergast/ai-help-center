import {
  MAX_ENTRY_CARDS,
  parseEntryCardInput,
  type EntryCard,
} from "@/lib/content/entry-cards";
import {
  ACTION_VARIANTS,
  MAX_ACTION_BUTTONS,
  MAX_ACTION_LABEL,
  isActionVariant,
  parseActionButtonInput,
  type ActionButton,
} from "@/lib/content/action-buttons";
import { ARTICLE_ICONS } from "@/lib/content/article-icons";
import {
  MAX_PROMPT_SUGGESTIONS,
  MAX_SUGGESTION_LENGTH,
  parsePromptSuggestions,
} from "@/lib/content/prompt-suggestions";
import {
  CONTACT_KINDS,
  MAX_CONTACT_METHODS,
  parseContactMethodInput,
  type ContactMethod,
} from "@/lib/content/contact-methods";
import {
  MAX_AI_REVIEWS_PER_DAY,
  MAX_AI_REVIEW_MESSAGE,
  MAX_AI_REVIEW_SUGGESTION,
  MIN_AI_REVIEW_MESSAGE,
  MIN_AI_REVIEW_SUGGESTION,
  parseAiReviewInput,
} from "@/lib/content/ai-review";
import { fail, ok, type McpTool, type ToolContext } from "./types";
import { frozen } from "./guards";

const FROZEN_RESULT = () =>
  fail(
    "plan_frozen",
    "This help center is frozen because of an overdue plan. Content changes are blocked until billing is settled.",
  );

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

export const listHeaderActions: McpTool = {
  name: "list_header_actions",
  title: "Kopf-Knöpfe lesen",
  description:
    "Read the action buttons shown in the help center's header. Call this before set_header_actions so you know what is already there.",
  scope: "articles:read",
  annotations: { readOnlyHint: true },
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    return ok({
      buttons: await content.store.listHeaderActions(ctx.tenant.id),
      max: MAX_ACTION_BUTTONS,
    });
  },
};

export const setHeaderActions: McpTool = {
  name: "set_header_actions",
  title: "Kopf-Knöpfe setzen",
  description:
    `REPLACES all action buttons in the help center header with the list you pass, in that order. At most ${MAX_ACTION_BUTTONS}. Pass an empty array to remove them all. Visible to end users immediately — there is no draft state. Use this for the one action that should be reachable from every page (book a call, status page, demo).`,
  scope: "updates:write",
  annotations: PUBLIC_HINTS,
  inputSchema: {
    type: "object",
    properties: {
      buttons: {
        type: "array",
        maxItems: MAX_ACTION_BUTTONS,
        description: "The complete new set of buttons, leftmost first.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: `Button text, max ${MAX_ACTION_LABEL} characters.` },
            href: {
              type: "string",
              description:
                "An absolute https URL, or a path inside this help center such as /contact. http:// is rejected — the button sits in the header of every page.",
            },
            icon: {
              type: "string",
              enum: [...ARTICLE_ICONS],
              description: "Optional icon; omit for text only.",
            },
            variant: {
              type: "string",
              enum: [...ACTION_VARIANTS],
              description:
                "ghost = text only; outlined = border, transparent; filled = high-contrast fill; colored = the help center's own brand colour. There is deliberately no free colour: buttons must not drift away from the instance's palette.",
            },
          },
          required: ["label", "href", "variant"],
        },
      },
    },
    required: ["buttons"],
  },
  async handler(args, ctx) {
    if (!Array.isArray(args.buttons)) return fail("invalid_params", "`buttons` must be an array.");
    if (args.buttons.length > MAX_ACTION_BUTTONS) {
      return fail(
        "too_many_buttons",
        `At most ${MAX_ACTION_BUTTONS} header buttons are allowed; ${args.buttons.length} were given.`,
      );
    }

    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    // ALLE prüfen, bevor irgendetwas geschrieben wird — die Knöpfe stehen im
    // Kopf JEDER Seite, ein Zwischenzustand wäre sofort überall sichtbar.
    const parsed: Omit<ActionButton, "id">[] = [];
    for (let i = 0; i < args.buttons.length; i += 1) {
      const res = parseActionButtonInput(args.buttons[i]);
      if (!res.ok) {
        return fail(res.error, `Button ${i + 1} was rejected: ${res.error}. Nothing was changed.`);
      }
      parsed.push(res.button);
    }

    const written = await content.store.replaceHeaderActions(ctx.tenant.id, parsed);
    return ok({ buttons: written, note: "Header buttons are live now." });
  },
};

export const getWidgetAppearance: McpTool = {
  name: "get_widget_appearance",
  title: "Widget-Erscheinungsbild lesen",
  description:
    "Read how the embeddable widget's launcher looks (variant, label, whether custom icons are set).",
  scope: "settings:read",
  annotations: { readOnlyHint: true },
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const w = ctx.tenant.widget;
    return ok({
      variant: w?.variant ?? "colored",
      label: w?.label ?? null,
      hasClosedIcon: Boolean(w?.iconUrl),
      hasOpenIcon: Boolean(w?.iconOpenUrl),
      note: "Icons are images and are uploaded by a person in the admin area — this server sets only variant and label.",
    });
  },
};

export const setWidgetAppearance: McpTool = {
  name: "set_widget_appearance",
  title: "Widget-Erscheinungsbild setzen",
  description:
    "Set the variant and label of the embeddable widget's launcher. Same four variants as the header buttons. An empty label makes it a round icon button. Visible to end users immediately. Icons cannot be set here — they are image uploads and stay with a person.",
  scope: "settings:write",
  annotations: PUBLIC_HINTS,
  inputSchema: {
    type: "object",
    properties: {
      variant: { type: "string", enum: [...ACTION_VARIANTS] },
      label: {
        type: "string",
        description: `Launcher text, max ${MAX_ACTION_LABEL} characters. Empty = icon only.`,
      },
    },
    required: ["variant"],
  },
  async handler(args, ctx) {
    if (!isActionVariant(args.variant)) {
      return fail("invalid_variant", `\`variant\` must be one of: ${ACTION_VARIANTS.join(", ")}.`);
    }
    const raw = typeof args.label === "string" ? args.label.trim() : "";
    if (raw.length > MAX_ACTION_LABEL) {
      return fail("label_too_long", `\`label\` must be at most ${MAX_ACTION_LABEL} characters.`);
    }

    const settings = await ctx.deps.getSettingsDeps?.();
    if (!settings) return fail("settings_unavailable", "Settings storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    const label = raw.length > 0 ? raw : null;
    await settings.setWidgetAppearance(ctx.tenant.id, args.variant, label);
    return ok({ variant: args.variant, label, note: "The widget launcher is updated." });
  },
};

export const reportUnclearPassage: McpTool = {
  name: "report_unclear_passage",
  title: "Unklare Stelle melden",
  description:
    `Report a passage in a published article that is unclear, contradictory or wrong. The report lands in the operator's inbox, marked as coming from an AI — it never changes the article itself. Use this when you notice a real problem while reading, not as a routine sweep. A SUGGESTION is required: saying only "this is unclear" moves the work instead of doing it. Limits: at most ${MAX_AI_REVIEWS_PER_DAY} reports per day for this help center, and one open report per passage. The response tells you how many are left.`,
  scope: "articles:write",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  inputSchema: {
    type: "object",
    properties: {
      articleId: { type: "string", description: "Id of the article (from list_articles)." },
      anchor: {
        type: "integer",
        minimum: 0,
        description:
          "Index of the body block the problem is in (0 = first block). Get the body with get_article and count from the top.",
      },
      quote: {
        type: "string",
        description: "The passage you mean, verbatim (max 300 characters). Helps if the block later moves.",
      },
      message: {
        type: "string",
        description: `What exactly is unclear or wrong, in ${MIN_AI_REVIEW_MESSAGE}-${MAX_AI_REVIEW_MESSAGE} characters. Be concrete — "confusing" is not a finding.`,
      },
      suggestion: {
        type: "string",
        description: `How it should read instead, in ${MIN_AI_REVIEW_SUGGESTION}-${MAX_AI_REVIEW_SUGGESTION} characters. REQUIRED.`,
      },
    },
    required: ["articleId", "anchor", "message", "suggestion"],
  },
  async handler(args, ctx) {
    const parsed = parseAiReviewInput(args);
    if (!parsed.ok) {
      return fail(parsed.error, `The report was rejected: ${parsed.error}.`);
    }

    const support = await ctx.deps.getSupportDeps?.();
    if (!support) return fail("support_unavailable", "The inbox is not available.");
    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    // Nur VERÖFFENTLICHTE Artikel: Ein Hinweis auf einen Entwurf meldet etwas,
    // das noch niemand sieht — und verrät nebenbei, dass es ihn gibt.
    const article = await content.store.getPublishedArticleBySlugOrId(
      ctx.tenant.id,
      ctx.tenant.defaultLocale,
      parsed.review.articleId,
    );
    if (!article) {
      return fail(
        "article_not_found",
        `No published article with id '${parsed.review.articleId}' in this help center.`,
      );
    }
    if (parsed.review.anchor >= article.body.length) {
      return fail(
        "invalid_anchor",
        `Block ${parsed.review.anchor} does not exist — the article has ${article.body.length} blocks (0-${article.body.length - 1}).`,
      );
    }

    // GRENZE 1 — Tagesdeckel je MANDANT. Schlüssel sind billig angelegt;
    // geschützt werden muss das Postfach, nicht der Schlüssel.
    const dayAgo = ctx.nowSec - 24 * 60 * 60;
    const used = await support.repo.countAiReviewsSince(ctx.tenant.id, dayAgo);
    if (used >= MAX_AI_REVIEWS_PER_DAY) {
      return fail(
        "daily_limit_reached",
        `This help center has reached its limit of ${MAX_AI_REVIEWS_PER_DAY} AI reports per day. Try again later, and report only what genuinely blocks a reader.`,
        { limit: MAX_AI_REVIEWS_PER_DAY, used },
      );
    }

    // GRENZE 2 — eine OFFENE Meldung je Stelle. Dieselbe Passage ein zweites
    // Mal zu melden bringt nichts; die KI erfährt stattdessen, dass es bekannt ist.
    if (await support.repo.hasOpenAiReview(ctx.tenant.id, article.id, parsed.review.anchor)) {
      return ok({
        created: false,
        reason: "already_reported",
        note: "There is already an open report for this passage. Nothing was added.",
        remainingToday: MAX_AI_REVIEWS_PER_DAY - used,
      });
    }

    await support.repo.create({
      tenantId: ctx.tenant.id,
      kind: "ai_review",
      message: parsed.review.message,
      contactEmail: null,
      question: null,
      articleId: article.id,
      anchor: parsed.review.anchor,
      quote: parsed.review.quote,
      suggestion: parsed.review.suggestion,
      // Die Meldung kommt von einem SCHLÜSSEL, nicht von einem Konto — eine
      // Nutzer-Identität vorzutäuschen wäre falsch. Der Schlüssel steht im Audit.
      actorType: "internal",
      visitorId: null,
      nowSec: ctx.nowSec,
    });

    return ok({
      created: true,
      article: article.slug,
      anchor: parsed.review.anchor,
      remainingToday: MAX_AI_REVIEWS_PER_DAY - used - 1,
      note: "Filed in the operator's inbox as an AI report. The article itself is unchanged.",
    });
  },
};

export const listPromptSuggestions: McpTool = {
  name: "list_prompt_suggestions",
  title: "Frage-Vorschläge lesen",
  description:
    "Read the example questions shown under the AI input on the start page. Call this before set_prompt_suggestions so you know what is already there.",
  scope: "articles:read",
  annotations: { readOnlyHint: true },
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    return ok({
      suggestions: await content.store.listPromptSuggestions(ctx.tenant.id),
      max: MAX_PROMPT_SUGGESTIONS,
    });
  },
};

export const setPromptSuggestions: McpTool = {
  name: "set_prompt_suggestions",
  title: "Frage-Vorschläge setzen",
  description:
    `REPLACES the example questions under the AI input with the list you pass, in that order. Between 0 and ${MAX_PROMPT_SUGGESTIONS}; an empty array removes them all. Visible to end users immediately. Write them as a READER would ask — real questions this help center can actually answer, not topic labels. Empty entries are dropped.`,
  scope: "updates:write",
  annotations: PUBLIC_HINTS,
  inputSchema: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        maxItems: MAX_PROMPT_SUGGESTIONS,
        description: `0 to ${MAX_PROMPT_SUGGESTIONS} questions, first one shown first.`,
        items: { type: "string", description: `A question, max ${MAX_SUGGESTION_LENGTH} characters.` },
      },
    },
    required: ["suggestions"],
  },
  async handler(args, ctx) {
    const parsed = parsePromptSuggestions(args.suggestions);
    if (!parsed.ok) {
      return fail(
        parsed.error,
        parsed.error === "too_many"
          ? `At most ${MAX_PROMPT_SUGGESTIONS} suggestions are allowed.`
          : `Suggestion ${(parsed.index ?? 0) + 1} was rejected: ${parsed.error}. Nothing was changed.`,
      );
    }

    const content = await ctx.deps.getContentDeps();
    if (!content) return fail("content_unavailable", "Content storage is not available.");
    if (await frozen(ctx)) return FROZEN_RESULT();

    const written = await content.store.replacePromptSuggestions(ctx.tenant.id, parsed.suggestions);
    return ok({
      suggestions: written,
      note:
        written > 0
          ? "The suggestions are live under the AI input now."
          : "All suggestions removed — the input now stands alone.",
    });
  },
};

export const NAVIGATION_TOOLS: McpTool[] = [
  reorderArticles,
  listEntryCards,
  setEntryCards,
  listContactMethods,
  setContactMethods,
  listHeaderActions,
  setHeaderActions,
  getWidgetAppearance,
  setWidgetAppearance,
  reportUnclearPassage,
  listPromptSuggestions,
  setPromptSuggestions,
];
