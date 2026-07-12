/**
 * Validierung für Legal-Docs pro Instanz (Impressum/Datenschutz/AGB) —
 * bewusst von Hand (kein Zod im Projekt), analog zu branding/validate.ts.
 *
 * SICHERHEITS-GRUNDSATZ (XSS-Vermeidung auf API-Ebene):
 *  - Ein Dokument ist ENTWEDER ein externer Link ODER Markdown-Text.
 *  - `mode=link`: die URL landet später in einem `<a href>` der öffentlichen
 *    Seite. Deshalb STRIKTE Schema-Whitelist: nur absolute `https://`-URLs.
 *    `http:`, `javascript:`, `data:`, `vbscript:` u. Ä. werden HART abgelehnt —
 *    das verhindert URL-basierte Script-Injection über das href-Attribut.
 *  - `mode=markdown`: der Text wird als reine DATEN gespeichert und 1:1 als
 *    Text zurückgegeben. Er wird hier NIEMALS serverseitig zu HTML gerendert
 *    (kein XSS-Vektor auf API-Ebene). Ein enthaltenes `<script>` ist damit nur
 *    Zeichenkette. Die spätere UI MUSS mit einem sicheren Markdown-Renderer mit
 *    DEAKTIVIERTEM Roh-HTML rendern (z. B. sanitize/`skipHtml`) — das ist ein
 *    bewusster, separater Schritt und passiert NICHT in dieser Schicht.
 */

/** Die drei pflegbaren Dokumenttypen (CHECK-Constraint der D1-Tabelle). */
export const LEGAL_DOC_TYPES = ["imprint", "privacy", "terms"] as const;
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number];

/** Ist der Wert einer der bekannten Dokumenttypen? */
export function isLegalDocType(value: unknown): value is LegalDocType {
  return typeof value === "string" && (LEGAL_DOC_TYPES as readonly string[]).includes(value);
}

/** Ausliefer-/Speicher-Modus eines Dokuments. */
export const LEGAL_MODES = ["link", "markdown"] as const;
export type LegalMode = (typeof LEGAL_MODES)[number];

/** URL-Längenlimit (verhindert Speicher-/Header-Missbrauch). */
export const MAX_LEGAL_URL_LENGTH = 2048;
/** Markdown-Größenlimit: 100 KB (UTF-8-Bytes). */
export const MAX_LEGAL_MARKDOWN_BYTES = 100 * 1024;

/** Persistierbare Nutzlast eines Dokuments (genau EINE der Varianten ist gesetzt). */
export interface LegalDocData {
  mode: LegalMode;
  url: string | null;
  markdown: string | null;
}

/** Ergebnis der Eingabe-Validierung: Erfolg (value) oder Fehlercode + HTTP-Status. */
export type LegalParseResult =
  | { ok: true; value: LegalDocData }
  | { ok: false; error: string; status: 400 | 413 };

const fail = (error: string, status: 400 | 413 = 400): LegalParseResult => ({
  ok: false,
  error,
  status,
});

/**
 * Strikte https-URL-Prüfung. Doppelt abgesichert:
 *  1. muss (getrimmt) mit `https://` beginnen — schließt andere Schemata aus,
 *  2. muss als absolute URL parsebar sein UND `protocol === "https:"` haben.
 * Kein Whitespace/keine Steuerzeichen (die einen Scheme-Split verschleiern
 * könnten). Gibt die getrimmte, kanonische URL zurück oder `null`.
 */
export function normalizeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || v.length > MAX_LEGAL_URL_LENGTH) return null;
  // Whitespace UND Steuerzeichen (0x00–0x1F) sperren — sie könnten einen
  // Scheme-Split verschleiern. Bindestriche/normale URL-Zeichen bleiben erlaubt.
  // eslint-disable-next-line no-control-regex -- Steuerzeichen sind hier bewusst Ziel
  if (/[\s\u0000-\u001f]/.test(v)) return null;
  if (!/^https:\/\//i.test(v)) return null;
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return null;
  }
  return parsed.protocol === "https:" ? v : null;
}

/** Byte-Länge eines Strings in UTF-8 (nicht Zeichen — Emoji zählen mehr). */
function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Prüft einen unbekannten Request-Body auf ein konsistentes Legal-Doc.
 * Erzwingt Modus-Exklusivität: link ⇒ nur `url`, markdown ⇒ nur `markdown`.
 */
export function parseLegalDoc(body: unknown): LegalParseResult {
  if (typeof body !== "object" || body === null) return fail("invalid_body");
  const b = body as Record<string, unknown>;

  const mode = b.mode;
  if (mode !== "link" && mode !== "markdown") return fail("invalid_mode");

  const hasUrl = b.url !== undefined && b.url !== null && b.url !== "";
  const hasMarkdown = b.markdown !== undefined && b.markdown !== null && b.markdown !== "";

  if (mode === "link") {
    // Inkonsistenz: markdown darf im Link-Modus nicht mitgeschickt werden.
    if (hasMarkdown) return fail("markdown_not_allowed");
    if (!hasUrl) return fail("url_required");
    const url = normalizeHttpsUrl(b.url);
    if (!url) return fail("invalid_url");
    return { ok: true, value: { mode: "link", url, markdown: null } };
  }

  // mode === "markdown"
  if (hasUrl) return fail("url_not_allowed");
  if (typeof b.markdown !== "string" || b.markdown.trim().length === 0) {
    return fail("markdown_required");
  }
  if (utf8Bytes(b.markdown) > MAX_LEGAL_MARKDOWN_BYTES) {
    return fail("markdown_too_large", 413);
  }
  return { ok: true, value: { mode: "markdown", url: null, markdown: b.markdown } };
}
