/**
 * KONTAKTWEGE der Seite `/contact` (Migration 0037).
 *
 * Jeder Weg ist eine Karte: Adresse, Telefon oder das Ticket-Formular.
 *
 * WARUM HIER (lib, nicht server): dieselbe Prüfung für den
 * Verwaltungsbereich und für jede spätere Maschinen-Tür. Eine Funktion kann
 * man nicht an einer Tür vergessen.
 */

export const CONTACT_KINDS = ["email", "phone", "form"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export interface ContactMethod {
  id: string;
  kind: ContactKind;
  title: string;
  /** Kann leer sein — dann zeigt die Karte nur Titel und Ziel. */
  description: string;
  /** Adresse (email) bzw. Rufnummer (phone); leer bei 'form'. */
  value: string;
}

/** Sechs Karten füllen zwei Reihen. Mehr Wege heißt: keiner ist mehr der Weg. */
export const MAX_CONTACT_METHODS = 6;
export const MAX_CONTACT_TITLE = 80;
export const MAX_CONTACT_DESCRIPTION = 200;
const MAX_VALUE_CHARS = 200;

/**
 * Bewusst großzügig: Rufnummern schreibt jedes Land anders (+49 30 / (030) /
 * 030-123 456). Wir prüfen nur, dass es plausibel eine Nummer IST — Ziffern
 * genug, keine Buchstaben, kein Schema-Schmuggel. Eine strenge E.164-Regel
 * würde korrekte Nummern ablehnen und niemanden schützen.
 */
const PHONE_RE = /^[+()\d][\d\s().\-/]{4,}$/;
/** Absichtlich simpel — die einzige belastbare Prüfung einer Adresse ist eine Mail dorthin. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

export type ContactMethodError =
  | "invalid_kind"
  | "title_required"
  | "title_too_long"
  | "description_too_long"
  | "value_required"
  | "invalid_email"
  | "invalid_phone";

export type ContactMethodParseResult =
  | { ok: true; method: Omit<ContactMethod, "id"> }
  | { ok: false; error: ContactMethodError };

export function isContactKind(v: unknown): v is ContactKind {
  return typeof v === "string" && (CONTACT_KINDS as readonly string[]).includes(v);
}

export function parseContactMethodInput(raw: unknown): ContactMethodParseResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_kind" };
  const o = raw as Record<string, unknown>;

  if (!isContactKind(o.kind)) return { ok: false, error: "invalid_kind" };
  const kind = o.kind;

  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (title.length === 0) return { ok: false, error: "title_required" };
  if (title.length > MAX_CONTACT_TITLE) return { ok: false, error: "title_too_long" };

  const description = typeof o.description === "string" ? o.description.trim() : "";
  if (description.length > MAX_CONTACT_DESCRIPTION) {
    return { ok: false, error: "description_too_long" };
  }

  // Das Formular trägt sein Ziel in der Art — ein zusätzlicher Wert wäre eine
  // zweite Wahrheit und wird deshalb verworfen, nicht gespeichert.
  if (kind === "form") return { ok: true, method: { kind, title, description, value: "" } };

  const value = typeof o.value === "string" ? o.value.trim() : "";
  if (value.length === 0) return { ok: false, error: "value_required" };
  if (value.length > MAX_VALUE_CHARS) {
    return { ok: false, error: kind === "email" ? "invalid_email" : "invalid_phone" };
  }
  if (kind === "email" && !EMAIL_RE.test(value)) return { ok: false, error: "invalid_email" };
  if (kind === "phone" && !PHONE_RE.test(value)) return { ok: false, error: "invalid_phone" };

  return { ok: true, method: { kind, title, description, value } };
}

/**
 * Klickziel der Karte. `null` = kein Link (das Formular ist die Karte selbst).
 *
 * `tel:` bekommt die Nummer OHNE Trennzeichen — Leerzeichen und Schrägstriche
 * lassen manche Telefon-Apps die Wahl abbrechen.
 */
export function contactMethodHref(method: ContactMethod): string | null {
  if (method.kind === "email") return `mailto:${method.value}`;
  if (method.kind === "phone") return `tel:${method.value.replace(/[^\d+]/g, "")}`;
  return null;
}
