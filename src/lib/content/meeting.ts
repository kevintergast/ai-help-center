/**
 * BUCHUNGSLINKS (0048) — „Persönliche Unterstützung buchen".
 *
 * MEHRERE Kalender je Instanz, EINE Stelle zum Pflegen. Ein allgemeines
 * Erstgespräch reicht selten: Die Einrichtung einer Telefonanlage braucht
 * einen anderen Termin als eine Produktfrage, und wer beides über denselben
 * Kalender schickt, sortiert hinterher von Hand.
 *
 * WARUM NICHT ALS KONTAKTWEG: Die Links erscheinen an bis zu vier
 * automatischen Stellen UND in Support-Bausteinen mitten im Artikel. Lägen
 * sie in `contact_methods`, stünde die Adresse an einer Stelle und die
 * Schalter dafür woanders — und wer den Kontaktweg löscht, risse die
 * Artikel-Platzierungen stumm mit weg.
 *
 * DIE PLATZIERUNGEN (Priorisierung des Teams, 2026-09-22):
 *  1. `article`  — am Artikelende. Direkt nach dem Lesen ist der Bedarf klar.
 *  2. `noHelp`   — nach „Nicht hilfreich" oder einer KI-Antwort ohne Treffer.
 *  3. `contact`  — eigene Karte auf der Kontaktseite.
 *  4. `home`     — zusätzliche Einstiegskarte auf der Startseite.
 *
 * An diesen vier Stellen steht IMMER derselbe Link (`placementLinkId`) — das
 * ist die allgemeine Hilfe. Die spezielleren Kalender erreicht man gezielt
 * über den Support-Baustein im Artikel (blocks.ts, `support`).
 *
 * Alle Platzierungen stehen standardmäßig AUS: Eine Fläche, die dem Endnutzer
 * etwas anbietet, darf auf einer laufenden Kundeninstanz nicht unangekündigt
 * erscheinen.
 */

export const MEETING_PLACEMENTS = ["article", "noHelp", "contact", "home"] as const;
export type MeetingPlacement = (typeof MEETING_PLACEMENTS)[number];

/** Fünf Kalender sind genug. Mehr sortiert niemand mehr auseinander. */
export const MAX_MEETING_LINKS = 5;
export const MAX_MEETING_ID = 40;
export const MAX_MEETING_LABEL = 40;
export const MAX_MEETING_TITLE = 80;
export const MAX_MEETING_DESCRIPTION = 200;
const MAX_URL_CHARS = 500;

/**
 * Kennung eines Kalenders. BEWUSST sprechend statt zufällig: Sie steht im
 * Support-Baustein („welcher Termin?") und im MCP-Aufruf. `telefonanlage` ist
 * dort lesbar, `ml_7f3a` wäre eine Rätselaufgabe für Mensch und Modell.
 */
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface MeetingLink {
  id: string;
  /** Überschrift, z. B. „Noch Fragen?". */
  title: string;
  /** Knopf-Beschriftung, z. B. „Termin buchen". */
  label: string;
  /** Eine Zeile darunter; leer erlaubt. */
  description: string;
  /** https-Adresse des Buchungskalenders. */
  url: string;
}

export interface MeetingConfig {
  links: MeetingLink[];
  placements: Record<MeetingPlacement, boolean>;
  /** Welcher Link an den vier automatischen Stellen steht. */
  placementLinkId: string;
}

export type MeetingError =
  | "links_required"
  | "too_many_links"
  | "invalid_id"
  | "duplicate_id"
  | "invalid_url"
  | "label_required"
  | "label_too_long"
  | "title_required"
  | "title_too_long"
  | "description_too_long";

export type MeetingParseResult =
  | { ok: true; config: MeetingConfig }
  | { ok: false; error: MeetingError };

/**
 * Buchungsadresse: NUR https, NUR absolut.
 *
 * Kein `http:` — dort trägt jemand Namen und Adresse ein. Kein interner Pfad:
 * Ein Buchungskalender liegt per Definition woanders, ein „/termin" wäre ein
 * toter Link an genau der Stelle, an der jemand schon nicht weiterkommt.
 * `javascript:`/`data:` scheitern an derselben Protokoll-Prüfung.
 */
export function isMeetingUrl(raw: string): boolean {
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_URL_CHARS) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function parseLink(raw: unknown): { ok: true; link: MeetingLink } | { ok: false; error: MeetingError } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_id" };
  const o = raw as Record<string, unknown>;

  const id = typeof o.id === "string" ? o.id.trim().toLowerCase() : "";
  if (id.length === 0 || id.length > MAX_MEETING_ID || !ID_RE.test(id)) {
    return { ok: false, error: "invalid_id" };
  }

  const url = typeof o.url === "string" ? o.url.trim() : "";
  if (!isMeetingUrl(url)) return { ok: false, error: "invalid_url" };

  const label = typeof o.label === "string" ? o.label.trim() : "";
  if (label.length === 0) return { ok: false, error: "label_required" };
  if (label.length > MAX_MEETING_LABEL) return { ok: false, error: "label_too_long" };

  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (title.length === 0) return { ok: false, error: "title_required" };
  if (title.length > MAX_MEETING_TITLE) return { ok: false, error: "title_too_long" };

  const description = typeof o.description === "string" ? o.description.trim() : "";
  if (description.length > MAX_MEETING_DESCRIPTION) {
    return { ok: false, error: "description_too_long" };
  }

  return { ok: true, link: { id, title, label, description, url } };
}

export function parseMeetingInput(raw: unknown): MeetingParseResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "links_required" };
  const o = raw as Record<string, unknown>;

  if (!Array.isArray(o.links) || o.links.length === 0) {
    return { ok: false, error: "links_required" };
  }
  if (o.links.length > MAX_MEETING_LINKS) return { ok: false, error: "too_many_links" };

  const links: MeetingLink[] = [];
  const seen = new Set<string>();
  for (const raw of o.links) {
    const res = parseLink(raw);
    if (!res.ok) return res;
    // Doppelte Kennungen wären mehrdeutig: Ein Baustein, der auf `beratung`
    // zeigt, träfe dann je nach Reihenfolge einen anderen Kalender.
    if (seen.has(res.link.id)) return { ok: false, error: "duplicate_id" };
    seen.add(res.link.id);
    links.push(res.link);
  }

  const p = (typeof o.placements === "object" && o.placements !== null ? o.placements : {}) as
    Record<string, unknown>;
  const placements = Object.fromEntries(
    // Fehlend = AUS. Bei einer Fläche, die dem Endnutzer etwas anbietet, ist
    // Schweigen keine Zustimmung.
    MEETING_PLACEMENTS.map((key) => [key, p[key] === true]),
  ) as Record<MeetingPlacement, boolean>;

  // Zeigt der gewünschte Platzierungs-Link ins Leere (gelöscht, vertippt),
  // gilt der erste — sonst verschwänden die automatischen Stellen stumm.
  const wanted = typeof o.placementLinkId === "string" ? o.placementLinkId.trim().toLowerCase() : "";
  const placementLinkId = seen.has(wanted) ? wanted : links[0].id;

  return { ok: true, config: { links, placements, placementLinkId } };
}

/** Liest die gespeicherte JSON-Spalte; unlesbar/leer ⇒ `null` (kein Termin). */
export function readMeetingConfig(raw: string | null | undefined): MeetingConfig | null {
  if (!raw) return null;
  try {
    const parsed = parseMeetingInput(JSON.parse(raw));
    return parsed.ok ? parsed.config : null;
  } catch {
    // Eine kaputte Zeile darf das Hilfezentrum nicht abschalten — dann gibt
    // es eben keinen Buchungslink.
    return null;
  }
}

export function serializeMeetingConfig(config: MeetingConfig | null): string | null {
  return config ? JSON.stringify(config) : null;
}

/** Erscheint an dieser automatischen Stelle etwas? */
export function showsAt(config: MeetingConfig | null, placement: MeetingPlacement): boolean {
  return config?.placements[placement] === true;
}

/** Der Link für die automatischen Stellen. */
export function placementLink(config: MeetingConfig | null): MeetingLink | null {
  if (!config) return null;
  return config.links.find((l) => l.id === config.placementLinkId) ?? config.links[0] ?? null;
}

/**
 * Ein bestimmter Kalender (Support-Baustein). Unbekannte Kennung ⇒ der
 * Platzierungs-Link: Ein Baustein, dessen Kalender gelöscht wurde, soll
 * weiterhin Hilfe anbieten statt leer dazustehen.
 */
export function meetingLinkById(config: MeetingConfig | null, id: string | null): MeetingLink | null {
  if (!config) return null;
  if (id) {
    const found = config.links.find((l) => l.id === id);
    if (found) return found;
  }
  return placementLink(config);
}

/**
 * Buchungsadresse MIT Kontext.
 *
 * Wunsch des Teams: „idealerweise mit Artikel oder Frage im Buchungsformular".
 * Angehängt wird `notes` — cal.com füllt damit das Notizfeld vor, andere
 * Dienste ignorieren einen unbekannten Parameter. Ein Gewinn ohne Risiko: Im
 * besten Fall weiß der Berater vorher, worum es geht, im schlechtesten ändert
 * sich nichts.
 *
 * Kontext ist IMMER etwas, das der Nutzer selbst erzeugt hat (Artikeltitel
 * oder seine eigene Frage) — nie etwas, das wir über ihn wissen.
 */
export function meetingHref(link: MeetingLink, context?: string | null): string {
  const note = (context ?? "").trim().slice(0, 200);
  if (note.length === 0) return link.url;
  try {
    const url = new URL(link.url);
    // Ein bereits gepflegtes `notes` gehört dem Betreiber und bleibt stehen.
    if (!url.searchParams.has("notes")) url.searchParams.set("notes", note);
    return url.toString();
  } catch {
    return link.url;
  }
}
