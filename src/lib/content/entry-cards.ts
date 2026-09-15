/**
 * EINSTIEGS-KARTEN der Startansicht (Migration 0035).
 *
 * Unter der KI-Eingabe steht sonst nichts als ein leeres Feld. Diese Karten
 * sind der vom Betreiber gesetzte erste Schritt: ein Einstiegsartikel, die
 * Roadmap, die Updates oder ein Ziel außerhalb.
 *
 * WARUM HIER (lib, nicht server): Es gibt zwei Türen — Verwaltungsbereich und
 * MCP. Beide müssen dieselbe Antwort auf „ist diese Karte gültig?" geben,
 * sonst legt die KI Karten an, die ein Mensch im Editor nicht speichern
 * könnte. Eine gemeinsame Funktion kann man nicht an einer Tür vergessen.
 */

export const ENTRY_CARD_KINDS = ["article", "roadmap", "changelog", "url"] as const;
export type EntryCardKind = (typeof ENTRY_CARD_KINDS)[number];

export interface EntryCard {
  id: string;
  kind: EntryCardKind;
  title: string;
  /** Kann leer sein — dann rendert die Karte nur den Titel. */
  description: string;
  /**
   * Bedeutung hängt an `kind`: Artikel-Slug (article), absolute https-Adresse
   * (url), leer bei roadmap/changelog (das Ziel steckt schon in der Art).
   */
  target: string;
}

/**
 * Sechs Karten füllen zwei Reihen à drei. Mehr ist keine Einstiegshilfe mehr,
 * sondern eine zweite Navigation neben der, die links schon steht.
 */
export const MAX_ENTRY_CARDS = 6;
export const MAX_ENTRY_CARD_TITLE = 80;
export const MAX_ENTRY_CARD_DESCRIPTION = 160;
const MAX_TARGET_CHARS = 500;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Stabile, maschinenlesbare Codes — die MCP-Tools reichen sie unverändert durch. */
export type EntryCardError =
  | "invalid_kind"
  | "title_required"
  | "title_too_long"
  | "description_too_long"
  | "target_required"
  | "invalid_slug"
  | "invalid_url";

export type EntryCardParseResult =
  | { ok: true; card: Omit<EntryCard, "id"> }
  | { ok: false; error: EntryCardError };

export function isEntryCardKind(v: unknown): v is EntryCardKind {
  return typeof v === "string" && (ENTRY_CARD_KINDS as readonly string[]).includes(v);
}

/**
 * Rohe Eingabe → geprüfte Karte. Bewusst STRENG (kein „repariere still"):
 * Eine Karte auf der Startseite ist das Erste, was ein Endnutzer sieht — ein
 * stillschweigend verbogenes Ziel wäre schlimmer als eine klare Absage.
 *
 * `url` erlaubt NUR https: Die Karte führt Endnutzer aus dem Hilfezentrum
 * heraus; http würde sie auf eine ungesicherte Verbindung schicken, und
 * `javascript:`/`data:` haben in einem Klickziel ohnehin nichts zu suchen.
 */
export function parseEntryCardInput(raw: unknown): EntryCardParseResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_kind" };
  const o = raw as Record<string, unknown>;

  if (!isEntryCardKind(o.kind)) return { ok: false, error: "invalid_kind" };
  const kind = o.kind;

  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (title.length === 0) return { ok: false, error: "title_required" };
  if (title.length > MAX_ENTRY_CARD_TITLE) return { ok: false, error: "title_too_long" };

  const description = typeof o.description === "string" ? o.description.trim() : "";
  if (description.length > MAX_ENTRY_CARD_DESCRIPTION) {
    return { ok: false, error: "description_too_long" };
  }

  const rawTarget = typeof o.target === "string" ? o.target.trim() : "";

  // Roadmap/Changelog tragen ihr Ziel in der Art — ein zusätzliches `target`
  // wäre eine zweite Wahrheit und wird deshalb verworfen, nicht gespeichert.
  if (kind === "roadmap" || kind === "changelog") {
    return { ok: true, card: { kind, title, description, target: "" } };
  }

  if (rawTarget.length === 0) return { ok: false, error: "target_required" };
  if (rawTarget.length > MAX_TARGET_CHARS) {
    return { ok: false, error: kind === "url" ? "invalid_url" : "invalid_slug" };
  }

  if (kind === "article") {
    if (!SLUG_RE.test(rawTarget)) return { ok: false, error: "invalid_slug" };
    return { ok: true, card: { kind, title, description, target: rawTarget } };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawTarget);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "invalid_url" };
  return { ok: true, card: { kind, title, description, target: parsed.toString() } };
}

/**
 * Wohin die Karte in der Oberfläche führt. `null` = eigene Ansicht im
 * Hilfezentrum (Roadmap/Changelog öffnen als Drill-Down, nicht als Seite).
 */
export function entryCardHref(card: EntryCard): string | null {
  if (card.kind === "article") return `/${card.target}`;
  if (card.kind === "url") return card.target;
  return null;
}
