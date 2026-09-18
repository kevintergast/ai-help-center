/**
 * „ICH VERSTEHE ETWAS NICHT" (Migration 0039) — Hinweise auf Stellen IM
 * Artikel, die ein Leser nicht versteht.
 *
 * ABGRENZUNG zu „Etwas stimmt nicht?": Das meldet eine falsche KI-ANTWORT.
 * Hier geht es um den Artikel selbst — anderer Anlass, anderer Kontext, aber
 * dasselbe Postfach (`support_tickets.kind`).
 *
 * Die Prüfung liegt hier, damit der öffentliche Melde-Endpunkt und jede
 * spätere Tür dieselbe Grenze ziehen.
 */

export const MIN_COMPREHENSION_MESSAGE = 5;
export const MAX_COMPREHENSION_MESSAGE = 2000;
export const MAX_COMPREHENSION_QUOTE = 300;
export const MAX_COMPREHENSION_EMAIL = 200;

export interface ComprehensionReport {
  /** Artikel, in dem geklickt wurde. */
  articleId: string;
  /** Index des angeklickten Blocks im Artikelkörper. */
  anchor: number;
  /** Text der angeklickten Stelle (gekürzt) — Kontext fürs Team. */
  quote: string;
  message: string;
  /** Freiwillig: Rückmelde-Adresse (der zweite Schritt darf übersprungen werden). */
  email: string | null;
}

export type ComprehensionError =
  | "article_required"
  | "invalid_anchor"
  | "message_too_short"
  | "message_too_long"
  | "invalid_email";

export type ComprehensionParseResult =
  | { ok: true; report: ComprehensionReport }
  | { ok: false; error: ComprehensionError };

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

export function parseComprehensionInput(raw: unknown): ComprehensionParseResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "article_required" };
  const o = raw as Record<string, unknown>;

  const articleId = typeof o.articleId === "string" ? o.articleId.trim() : "";
  if (articleId.length === 0) return { ok: false, error: "article_required" };

  // Block-Index: ganze Zahl ab 0. Eine negative oder gebrochene Zahl wäre kein
  // Block, sondern ein Tippfehler im Aufrufer.
  const anchor = typeof o.anchor === "number" ? o.anchor : NaN;
  if (!Number.isInteger(anchor) || anchor < 0) return { ok: false, error: "invalid_anchor" };

  const message = typeof o.message === "string" ? o.message.trim() : "";
  if (message.length < MIN_COMPREHENSION_MESSAGE) return { ok: false, error: "message_too_short" };
  if (message.length > MAX_COMPREHENSION_MESSAGE) return { ok: false, error: "message_too_long" };

  const quote =
    typeof o.quote === "string" ? o.quote.trim().slice(0, MAX_COMPREHENSION_QUOTE) : "";

  // Leer ist gültig — der zweite Schritt ist ausdrücklich freiwillig. Eine
  // ANGEGEBENE Adresse muss aber plausibel sein, sonst verspricht die
  // Oberfläche eine Rückmeldung, die nie ankommt.
  const rawEmail = typeof o.email === "string" ? o.email.trim() : "";
  if (rawEmail.length > MAX_COMPREHENSION_EMAIL) return { ok: false, error: "invalid_email" };
  if (rawEmail.length > 0 && !EMAIL_RE.test(rawEmail)) return { ok: false, error: "invalid_email" };

  return {
    ok: true,
    report: { articleId, anchor, quote, message, email: rawEmail.length > 0 ? rawEmail : null },
  };
}
