/**
 * KI-MELDUNGEN zu unklaren Stellen (`support_tickets.kind = 'ai_review'`).
 *
 * WARUM EINE EIGENE ART und nicht dieselbe wie „Ich verstehe etwas nicht":
 * Ein Mensch, der meldet, dass er nicht weiterkommt, ist SELTEN und wertvoll —
 * dahinter steht jemand, der gerade scheitert. Eine KI kann davon fünfhundert
 * in einer Minute erzeugen. Lägen beide im selben Topf, würde das menschliche
 * Signal darin ersaufen, das Team fängt an zu überfliegen, und die Funktion
 * verliert genau den Wert, für den sie gebaut wurde.
 *
 * DESHALB DIE GRENZEN — sie sind hier keine Vorsichtsmaßnahme, sondern das,
 * was die Funktion überhaupt tragbar macht:
 *
 *  1. TAGESDECKEL je Mandant (nicht je Schlüssel): Schlüssel sind billig
 *     angelegt; geschützt werden muss das Postfach, nicht der Schlüssel.
 *  2. EINE OFFENE MELDUNG je Stelle: Dieselbe Passage zweimal zu melden
 *     bringt nichts. Der zweite Versuch bekommt eine klare Antwort statt eines
 *     zweiten Eintrags — und die KI erfährt, dass es schon bekannt ist.
 *  3. VORSCHLAG IST PFLICHT: „Das ist unklar" verlagert die Arbeit nur. Wer
 *     meldet, sagt auch, wie es besser hieße.
 *  4. Die Antwort nennt das VERBLEIBENDE Kontingent — sonst probiert ein
 *     Modell blind weiter und läuft in eine Wand, die es nicht sieht.
 */

/** Meldungen je Mandant und Tag. Bewusst knapp: Das ist ein Postfach, keine Warteschlange. */
export const MAX_AI_REVIEWS_PER_DAY = 20;
export const MIN_AI_REVIEW_MESSAGE = 20;
export const MAX_AI_REVIEW_MESSAGE = 1000;
export const MIN_AI_REVIEW_SUGGESTION = 20;
export const MAX_AI_REVIEW_SUGGESTION = 1000;

export interface AiReview {
  articleId: string;
  anchor: number;
  quote: string;
  message: string;
  suggestion: string;
}

export type AiReviewError =
  | "article_required"
  | "invalid_anchor"
  | "message_too_short"
  | "message_too_long"
  | "suggestion_required"
  | "suggestion_too_short"
  | "suggestion_too_long";

export type AiReviewParseResult =
  | { ok: true; review: AiReview }
  | { ok: false; error: AiReviewError };

export function parseAiReviewInput(raw: unknown): AiReviewParseResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "article_required" };
  const o = raw as Record<string, unknown>;

  const articleId = typeof o.articleId === "string" ? o.articleId.trim() : "";
  if (articleId.length === 0) return { ok: false, error: "article_required" };

  const anchor = typeof o.anchor === "number" ? o.anchor : NaN;
  if (!Number.isInteger(anchor) || anchor < 0) return { ok: false, error: "invalid_anchor" };

  const message = typeof o.message === "string" ? o.message.trim() : "";
  if (message.length < MIN_AI_REVIEW_MESSAGE) return { ok: false, error: "message_too_short" };
  if (message.length > MAX_AI_REVIEW_MESSAGE) return { ok: false, error: "message_too_long" };

  const suggestion = typeof o.suggestion === "string" ? o.suggestion.trim() : "";
  if (suggestion.length === 0) return { ok: false, error: "suggestion_required" };
  if (suggestion.length < MIN_AI_REVIEW_SUGGESTION) {
    return { ok: false, error: "suggestion_too_short" };
  }
  if (suggestion.length > MAX_AI_REVIEW_SUGGESTION) {
    return { ok: false, error: "suggestion_too_long" };
  }

  const quote = typeof o.quote === "string" ? o.quote.trim().slice(0, 300) : "";
  return { ok: true, review: { articleId, anchor, quote, message, suggestion } };
}
