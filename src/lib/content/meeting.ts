/**
 * MEETING-LINK (0048) — „Persönliche Unterstützung buchen".
 *
 * EINE Konfiguration je Instanz, VIER Platzierungen. Das ist der Kern der
 * Entscheidung: Die Buchungsadresse steht genau einmal. Hätten wir den Link
 * als vierten Kontaktweg gespeichert und die übrigen Platzierungen über
 * separate Schalter gesteuert, stünde dieselbe Adresse an zwei Orten — und
 * wer den Kontaktweg löscht, risse die Artikel-Platzierung stumm mit weg.
 *
 * DIE PLATZIERUNGEN (Priorisierung des Teams, 2026-09-22):
 *  1. `article`  — am Artikelende. Direkt nach dem Lesen ist der Bedarf klar.
 *  2. `noHelp`   — nach „Nicht hilfreich" oder einer KI-Antwort ohne Treffer.
 *                  Der Moment, in dem die Selbstbedienung nachweislich
 *                  gescheitert ist; persönliche Hilfe ist der nächste Schritt.
 *  3. `contact`  — eigene Karte auf der Kontaktseite, neben E-Mail/Telefon.
 *  4. `home`     — zusätzliche Einstiegskarte auf der Startseite.
 *
 * ALLE VIER sind einzeln abschaltbar und stehen standardmäßig AUS: Ein
 * Buchungslink, den niemand gepflegt hat, darf nirgends auftauchen — und eine
 * neue Fläche soll auf einer laufenden Kundeninstanz nicht unangekündigt
 * erscheinen.
 */

export const MEETING_PLACEMENTS = ["article", "noHelp", "contact", "home"] as const;
export type MeetingPlacement = (typeof MEETING_PLACEMENTS)[number];

export const MAX_MEETING_LABEL = 40;
export const MAX_MEETING_TITLE = 80;
export const MAX_MEETING_DESCRIPTION = 200;
const MAX_URL_CHARS = 500;

export interface MeetingConfig {
  /** https-Adresse des Buchungskalenders (cal.com, Calendly, Bookings …). */
  url: string;
  /** Beschriftung des Knopfes, z. B. „Termin buchen". */
  label: string;
  /** Überschrift der Karte/des Hinweises, z. B. „Noch Fragen?". */
  title: string;
  /** Eine Zeile darunter; leer erlaubt. */
  description: string;
  /** Wo der Link erscheint. */
  placements: Record<MeetingPlacement, boolean>;
}

export type MeetingError =
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
 * Kein `http:` — dort trägt jemand Namen und Adresse ein. Kein interner Pfad
 * (anders als bei den Kopf-Knöpfen): Ein Buchungskalender liegt per Definition
 * woanders, ein „/termin" wäre ein toter Link, den niemand bemerkt.
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

export function parseMeetingInput(raw: unknown): MeetingParseResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_url" };
  const o = raw as Record<string, unknown>;

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

  const p = (typeof o.placements === "object" && o.placements !== null ? o.placements : {}) as
    Record<string, unknown>;
  const placements = Object.fromEntries(
    // Fehlend = AUS. Bei einer Fläche, die dem Endnutzer etwas anbietet, ist
    // Schweigen keine Zustimmung — anders als bei den Rechtstext-Links im Fuß,
    // wo ein fehlender Wert den Bestand erhält.
    MEETING_PLACEMENTS.map((key) => [key, p[key] === true]),
  ) as Record<MeetingPlacement, boolean>;

  return { ok: true, config: { url, label, title, description, placements } };
}

/** Liest die gespeicherte JSON-Spalte; unlesbar/leer ⇒ `null` (kein Meeting). */
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

/** Erscheint der Link an dieser Stelle? */
export function showsAt(config: MeetingConfig | null, placement: MeetingPlacement): boolean {
  return config?.placements[placement] === true;
}

/**
 * Buchungsadresse MIT Kontext.
 *
 * Wunsch des Teams: „idealerweise mit Artikel oder Frage im Buchungsformular".
 * Angehängt wird `notes` — cal.com füllt damit das Notizfeld vor, andere
 * Dienste ignorieren einen unbekannten Parameter einfach. Deshalb ist das ein
 * Gewinn ohne Risiko: Im besten Fall weiß der Berater vorher, worum es geht,
 * im schlechtesten ändert sich nichts.
 *
 * Kontext ist IMMER etwas, das der Nutzer selbst erzeugt hat (Artikeltitel
 * oder seine eigene Frage) — nie etwas, das wir über ihn wissen.
 */
export function meetingHref(config: MeetingConfig, context?: string | null): string {
  const note = (context ?? "").trim().slice(0, 200);
  if (note.length === 0) return config.url;
  try {
    const url = new URL(config.url);
    // Ein bereits gepflegtes `notes` gehört dem Betreiber und bleibt stehen.
    if (!url.searchParams.has("notes")) url.searchParams.set("notes", note);
    return url.toString();
  } catch {
    return config.url;
  }
}
