/**
 * BLOCK-MODELL des Artikel-Bodys (Editor-Umbau 2026-07-20).
 *
 * Ein Artikel ist eine GEORDNETE Liste typisierter Blöcke:
 *  - text (Varianten standard/info/warning/error/code; Markdown-Subset
 *    aus rich-text.ts inkl. [Links](https://…) — code = Rohtext)
 *  - image  (referenziert ein ANGEHÄNGTES Bild über seine imageId)
 *  - video  (referenziert ein Artikel-Video über seine videoId)
 *  - articleLink (Card auf einen anderen Artikel: Slug + eigener Titel/
 *    Beschreibung + optionaler Tag mit Text und PALETTEN-Farbe)
 *  - table    (Kopfzeile + Zeilen)
 *  - accordion (aufklappbarer Abschnitt: Titel + Rich-Text-Inhalt)
 *  - button   (Aktions-Button: Beschriftung + Ziel-URL/interner Pfad)
 *  - divider  (Trennlinie)
 *  - file     (Datei-Anhang zum Herunterladen, referenziert über fileId)
 *
 * SPEICHERFORM (body_json) bleibt ein MIXED-Array: Standard-Textblöcke als
 * NACKTE STRINGS (exakt wie vor dem Umbau), alles andere als Objekte.
 * Diese Kanonisierung ist tragend: bestehende Artikel bleiben byte-gleich,
 * und `blockTexts` liefert für sie EXAKT dieselben Strings wie der alte
 * Lesepfad → RAG-Chunks/Staleness-Hashes bestehender Inhalte kippen NICHT.
 *
 * SICHERHEIT: Alle Textfelder werden als DATEN gespeichert und in React
 * als Text gerendert (kein HTML); Farben kommen ausschließlich aus der
 * festen Palette (kein freies CSS); Slugs sind format-validiert.
 */

/** Feste Farb-Palette für Tags/Flags (Mapping auf Design-Töne, kein freies CSS). */
export const TAG_COLORS = ["neutral", "brand", "ok", "warn", "crit"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export interface ArticleTag {
  text: string;
  color: TagColor;
}

/** Artikel-Flag (Badge am Artikel, z. B. „Beta" / „Wichtig") — wie ein Tag. */
export type ArticleFlag = ArticleTag;

export const TEXT_VARIANTS = ["standard", "info", "warning", "error", "code"] as const;
export type TextVariant = (typeof TEXT_VARIANTS)[number];

export type ArticleBlock =
  | { type: "text"; variant: TextVariant; text: string }
  | { type: "image"; imageId: string }
  | {
      /**
       * Tabelle (Import-Fund 2026-08-22: Doku-Artikel verlieren ohne sie ihre
       * Parameter-/Feld-Übersichten). `head` darf leer sein (Tabelle ohne
       * Kopfzeile); `rows` sind Zeilen gleicher Länge (kürzere werden im
       * Renderer aufgefüllt).
       */
      type: "table";
      head: string[];
      rows: string[][];
    }
  | { type: "video"; videoId: string }
  | {
      /**
       * AUFKLAPPBARER ABSCHNITT (Referenz: Zendesk/Intercom „Collapsible").
       * Für FAQ und optionale Details in langen Artikeln. Der Inhalt bleibt
       * im KI-Index (blockTexts) — eingeklappt heißt sichtbar für die Suche,
       * nur nicht sofort für das Auge.
       */
      type: "accordion";
      title: string;
      text: string;
    }
  | {
      /**
       * AKTIONS-BUTTON: Beschriftung + Ziel. Erlaubt sind http(s)-URLs und
       * INSTANZ-INTERNE Pfade ("/slug") — niemals javascript:/data: (XSS).
       */
      type: "button";
      label: string;
      href: string;
    }
  | { type: "divider" }
  | {
      /** DATEI-ANHANG (Vorlagen/Formulare) — Metadaten liegen in files_json. */
      type: "file";
      fileId: string;
    }
  | ({ type: "articleLink" } & ArticleLinkCard)
  | {
      /**
       * KARTEN-GITTER aus mehreren Artikel-Verweisen („Weitere Features",
       * „Passende Integrationen"). Fremde Hilfezentren bauen solche Abschnitte
       * als Kachel-Navigation; ein einzelner `articleLink` je Zeile wird dem
       * nicht gerecht, weil die Karten NEBENEINANDER gehören und als eine
       * Einheit gelesen werden.
       *
       * Bewusst ein eigener Typ statt „mehrere articleLink hintereinander":
       * Nur so weiß der Renderer, dass die Karten ein Gitter bilden, und nur
       * so kann eine KI die Sammlung als Ganzes anlegen und ersetzen.
       */
      type: "articleLinks";
      items: ArticleLinkCard[];
    };

/** Eine Verweis-Karte: Ziel-Slug + eigener Text (nicht der des Zielartikels). */
export interface ArticleLinkCard {
  slug: string;
  title: string;
  description: string;
  tag: ArticleTag | null;
}

const MAX_TEXT_CHARS = 8_000;
const MAX_TABLE_COLS = 12;
const MAX_TABLE_ROWS = 200;
const MAX_CELL_CHARS = 500;
const MAX_CARD_TITLE = 120;
const MAX_ACCORDION_TITLE = 160;
const MAX_BUTTON_LABEL = 80;
const MAX_HREF_CHARS = 500;
const MAX_CARD_DESCRIPTION = 300;
/** Karten je Gitter. Mehr ist keine Navigation mehr, sondern eine Liste. */
export const MAX_LINK_CARDS = 12;
export const MAX_TAG_TEXT = 24;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Button-Ziel: nur http(s) ODER ein instanz-interner Pfad. Alles andere
 * (javascript:, data:, protokoll-relativ "//host") wird abgelehnt — ein Button
 * ist ein Klickziel für Endnutzer, hier darf kein Skript-Schema durchkommen.
 */
export function isAllowedButtonHref(raw: string): boolean {
  const href = raw.trim();
  if (href.length === 0 || href.length > MAX_HREF_CHARS) return false;
  if (href.startsWith("//")) return false;
  if (href.startsWith("/")) return true;
  return /^https?:\/\//i.test(href);
}

function isTagColor(v: unknown): v is TagColor {
  return typeof v === "string" && (TAG_COLORS as readonly string[]).includes(v);
}

/** Tag/Flag aus unbekannter Eingabe — null bei fehlend/leer, undefined bei UNGÜLTIG. */
export function parseTagInput(raw: unknown): ArticleTag | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return undefined;
  const o = raw as { text?: unknown; color?: unknown };
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (text.length === 0) return null; // leerer Text = Tag entfernt
  if (text.length > MAX_TAG_TEXT || !isTagColor(o.color)) return undefined;
  return { text, color: o.color };
}

/**
 * LESE-Pfad (tolerant): body_json-Einträge → Blöcke. Strings sind Standard-
 * Text (Altbestand + Kanonisierung); unbekannte/kaputte Objekte werden
 * verworfen statt die Seite zu reißen.
 */
export function parseArticleBody(raw: unknown): ArticleBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ArticleBlock[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      out.push({ type: "text", variant: "standard", text: entry });
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const o = entry as Record<string, unknown>;
    if (o.type === "text" && typeof o.text === "string") {
      const variant = (TEXT_VARIANTS as readonly string[]).includes(o.variant as string)
        ? (o.variant as TextVariant)
        : "standard";
      out.push({ type: "text", variant, text: o.text });
    } else if (o.type === "table" && Array.isArray(o.rows)) {
      const head = Array.isArray(o.head) ? o.head.filter((h): h is string => typeof h === "string") : [];
      const rows = (o.rows as unknown[])
        .filter((r): r is unknown[] => Array.isArray(r))
        .map((r) => r.filter((c): c is string => typeof c === "string"));
      if (rows.length > 0 || head.length > 0) out.push({ type: "table", head, rows });
    } else if (o.type === "image" && typeof o.imageId === "string") {
      out.push({ type: "image", imageId: o.imageId });
    } else if (o.type === "video" && typeof o.videoId === "string") {
      out.push({ type: "video", videoId: o.videoId });
    } else if (o.type === "accordion" && typeof o.title === "string" && typeof o.text === "string") {
      out.push({ type: "accordion", title: o.title, text: o.text });
    } else if (
      o.type === "button" &&
      typeof o.label === "string" &&
      typeof o.href === "string" &&
      isAllowedButtonHref(o.href)
    ) {
      out.push({ type: "button", label: o.label, href: o.href.trim() });
    } else if (o.type === "divider") {
      out.push({ type: "divider" });
    } else if (o.type === "file" && typeof o.fileId === "string") {
      out.push({ type: "file", fileId: o.fileId });
    } else if (
      o.type === "articleLink" &&
      typeof o.slug === "string" &&
      typeof o.title === "string"
    ) {
      out.push({ type: "articleLink", ...cardLenient(o) });
    } else if (o.type === "articleLinks" && Array.isArray(o.items)) {
      const items: ArticleLinkCard[] = [];
      for (const raw of o.items) {
        if (typeof raw !== "object" || raw === null) continue;
        const c = raw as Record<string, unknown>;
        if (typeof c.slug !== "string" || typeof c.title !== "string") continue;
        items.push(cardLenient(c));
      }
      // Ein leeres Gitter ist kein Block — es würde als Nichts rendern.
      if (items.length > 0) out.push({ type: "articleLinks", items });
    }
  }
  return out;
}

/** LESE-Pfad: Karte aus bereits als String geprüftem slug/title bauen. */
function cardLenient(o: Record<string, unknown>): ArticleLinkCard {
  return {
    slug: o.slug as string,
    title: o.title as string,
    description: typeof o.description === "string" ? o.description : "",
    tag: parseTagInput(o.tag) ?? null,
  };
}

/**
 * SCHREIB-Pfad: eine Verweis-Karte streng prüfen. Von `articleLink` UND
 * `articleLinks` benutzt — eine Karte, eine Regel, egal in welchem Block sie
 * steckt.
 */
function validateCard(raw: unknown): { ok: true; value: ArticleLinkCard } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_body" };
  const o = raw as Record<string, unknown>;
  const slug = typeof o.slug === "string" ? o.slug.trim() : "";
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const description = typeof o.description === "string" ? o.description.trim() : "";
  if (!SLUG_RE.test(slug) || slug.length > 80) return { ok: false, error: "invalid_card_slug" };
  if (title.length === 0 || title.length > MAX_CARD_TITLE) return { ok: false, error: "invalid_card_title" };
  if (description.length > MAX_CARD_DESCRIPTION) return { ok: false, error: "invalid_card_description" };
  const tag = parseTagInput(o.tag);
  if (tag === undefined) return { ok: false, error: "invalid_tag" };
  return { ok: true, value: { slug, title, description, tag } };
}

/**
 * SCHREIB-Pfad (streng): unbekannte Eingabe → validierte Blöcke oder
 * Fehlercode. Strings bleiben als Standard-Text erlaubt (Import/Altclients).
 */
export function validateBodyInput(raw: unknown): { ok: true; value: ArticleBlock[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "invalid_body" };
  const out: ArticleBlock[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (entry.length > MAX_TEXT_CHARS) return { ok: false, error: "body_block_too_large" };
      out.push({ type: "text", variant: "standard", text: entry });
      continue;
    }
    if (typeof entry !== "object" || entry === null) return { ok: false, error: "invalid_body" };
    const o = entry as Record<string, unknown>;
    switch (o.type) {
      case "text": {
        if (typeof o.text !== "string" || o.text.length > MAX_TEXT_CHARS) {
          return { ok: false, error: "invalid_body" };
        }
        if (!(TEXT_VARIANTS as readonly string[]).includes(o.variant as string)) {
          return { ok: false, error: "invalid_text_variant" };
        }
        out.push({ type: "text", variant: o.variant as TextVariant, text: o.text });
        break;
      }
      case "table": {
        const head = Array.isArray(o.head) ? o.head : [];
        const rows = Array.isArray(o.rows) ? o.rows : [];
        if (!head.every((h) => typeof h === "string") || head.length > MAX_TABLE_COLS) {
          return { ok: false, error: "invalid_table" };
        }
        if (rows.length > MAX_TABLE_ROWS) return { ok: false, error: "table_too_large" };
        const cleanRows: string[][] = [];
        for (const row of rows) {
          if (!Array.isArray(row) || row.length > MAX_TABLE_COLS) return { ok: false, error: "invalid_table" };
          if (!row.every((c) => typeof c === "string" && c.length <= MAX_CELL_CHARS)) {
            return { ok: false, error: "invalid_table" };
          }
          cleanRows.push(row as string[]);
        }
        if (head.length === 0 && cleanRows.length === 0) return { ok: false, error: "invalid_table" };
        out.push({ type: "table", head: head as string[], rows: cleanRows });
        break;
      }
      case "image": {
        if (typeof o.imageId !== "string" || o.imageId.length === 0 || o.imageId.length > 80) {
          return { ok: false, error: "invalid_image_block" };
        }
        out.push({ type: "image", imageId: o.imageId });
        break;
      }
      case "video": {
        if (typeof o.videoId !== "string" || o.videoId.length === 0 || o.videoId.length > 80) {
          return { ok: false, error: "invalid_video_block" };
        }
        out.push({ type: "video", videoId: o.videoId });
        break;
      }
      case "accordion": {
        const title = typeof o.title === "string" ? o.title.trim() : "";
        if (title.length === 0 || title.length > MAX_ACCORDION_TITLE) {
          return { ok: false, error: "invalid_accordion_title" };
        }
        if (typeof o.text !== "string" || o.text.length > MAX_TEXT_CHARS) {
          return { ok: false, error: "invalid_accordion_text" };
        }
        out.push({ type: "accordion", title, text: o.text });
        break;
      }
      case "button": {
        const label = typeof o.label === "string" ? o.label.trim() : "";
        if (label.length === 0 || label.length > MAX_BUTTON_LABEL) {
          return { ok: false, error: "invalid_button_label" };
        }
        if (typeof o.href !== "string" || !isAllowedButtonHref(o.href)) {
          return { ok: false, error: "invalid_button_href" };
        }
        out.push({ type: "button", label, href: o.href.trim() });
        break;
      }
      case "divider": {
        out.push({ type: "divider" });
        break;
      }
      case "file": {
        if (typeof o.fileId !== "string" || o.fileId.length === 0 || o.fileId.length > 80) {
          return { ok: false, error: "invalid_file_block" };
        }
        out.push({ type: "file", fileId: o.fileId });
        break;
      }
      case "articleLink": {
        const card = validateCard(o);
        if (!card.ok) return card;
        out.push({ type: "articleLink", ...card.value });
        break;
      }
      case "articleLinks": {
        if (!Array.isArray(o.items) || o.items.length === 0) {
          return { ok: false, error: "invalid_card_list" };
        }
        if (o.items.length > MAX_LINK_CARDS) return { ok: false, error: "too_many_cards" };
        const items: ArticleLinkCard[] = [];
        for (const raw of o.items) {
          const card = validateCard(raw);
          if (!card.ok) return card;
          items.push(card.value);
        }
        out.push({ type: "articleLinks", items });
        break;
      }
      default:
        return { ok: false, error: "invalid_body" };
    }
  }
  return { ok: true, value: out };
}

/**
 * SPEICHERFORM: Standard-Text → nackter String (Byte-Kompatibilität zu
 * Bestandsdaten + stabile Hashes), alles andere → Objekt.
 */
export function serializeBody(blocks: ArticleBlock[]): unknown[] {
  return blocks.map((b) => (b.type === "text" && b.variant === "standard" ? b.text : b));
}

/**
 * TEXT-Ableitung (RAG-Index, Lesezeit, Suche): liefert für reine Standard-
 * Text-Bodies EXAKT die gespeicherten Strings (Hash-Invariante!). Bild-/
 * Video-Blöcke tragen NICHTS bei — deren Beschreibungen kommen weiterhin aus
 * den Anhängen (images_json/videos_json), sonst gäbe es doppelte Index-Zeilen.
 */
/** Index-Zeile einer Verweis-Karte (identisch für Einzelkarte und Gitter). */
function cardText(c: ArticleLinkCard): string {
  const desc = c.description.trim();
  return `→ ${c.title}${desc.length > 0 ? `: ${desc}` : ""}`;
}

export function blockTexts(blocks: ArticleBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "text") {
      if (b.text.trim().length > 0) out.push(b.text);
    } else if (b.type === "articleLink") {
      out.push(cardText(b));
    } else if (b.type === "articleLinks") {
      // Je Karte eine Zeile — die KI soll einzelne Verweise nennen können,
      // nicht nur „hier gibt es ein Gitter".
      for (const c of b.items) out.push(cardText(c));
    } else if (b.type === "accordion") {
      // Titel UND Inhalt in den Index: FAQ-Antworten stecken oft genau hier.
      const text = b.text.trim();
      out.push(text.length > 0 ? `${b.title}\n${text}` : b.title);
    } else if (b.type === "button") {
      // Beschriftung + Ziel, damit die KI den Weg nennen kann („öffne …").
      out.push(`→ ${b.label}: ${b.href}`);
    } else if (b.type === "table") {
      // Zeilenweise als „Spalte: Wert"-Paare — so findet die KI einzelne
      // Felder wieder (eine reine Pipe-Zeile wäre schlechter Suchkontext).
      const lines = b.rows.map((row) =>
        row
          .map((cell, i) => (b.head[i] ? `${b.head[i]}: ${cell}` : cell))
          .filter((x) => x.trim().length > 0)
          .join(" — "),
      );
      const text = lines.filter((l) => l.length > 0).join("\n");
      if (text.length > 0) out.push(text);
    }
  }
  return out;
}

/**
 * Übersetzbare Textfelder in STABILER Reihenfolge extrahieren bzw. nach der
 * Übersetzung zurückschreiben (KI-Übersetzung): Text-Blöcke außer CODE
 * (Code bleibt Code) sowie Card-Titel und -Beschreibung. Tag-Texte bleiben
 * bewusst unübersetzt (Eigenlabels wie „Beta").
 */
export function extractTranslatableTexts(blocks: ArticleBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "text" && b.variant !== "code") out.push(b.text);
    else if (b.type === "accordion") out.push(b.title, b.text);
    else if (b.type === "button") out.push(b.label);
    else if (b.type === "articleLink") out.push(b.title, b.description);
    else if (b.type === "table") out.push(...b.head, ...b.rows.flat());
  }
  return out;
}

export function applyTranslatedTexts(blocks: ArticleBlock[], texts: string[]): ArticleBlock[] {
  let i = 0;
  const next = (): string => texts[i++] ?? "";
  return blocks.map((b) => {
    if (b.type === "text" && b.variant !== "code") return { ...b, text: next() };
    if (b.type === "accordion") return { ...b, title: next(), text: next() };
    // Ziel-URL bleibt unübersetzt, nur die Beschriftung.
    if (b.type === "button") return { ...b, label: next() };
    if (b.type === "articleLink") return { ...b, title: next(), description: next() };
    if (b.type === "table") {
      return { ...b, head: b.head.map(() => next()), rows: b.rows.map((r) => r.map(() => next())) };
    }
    return b;
  });
}

/**
 * TABELLEN im Editor: Pipe-Syntax („| Feld | Inhalt |") ist für Doku-Tabellen
 * schnell zu tippen und aus Markdown vertraut. Erste Zeile = Kopfzeile;
 * eine reine Trennzeile (`|---|---|`) wird ignoriert.
 */
export function pipeToTable(input: string): { head: string[]; rows: string[][] } {
  const lines = input
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\|?\s*:?-{2,}/.test(l.replace(/\|/g, "|")));
  const cells = (line: string): string[] =>
    line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  if (lines.length === 0) return { head: [], rows: [] };
  return { head: cells(lines[0]), rows: lines.slice(1).map(cells) };
}

export function tableToPipe(table: { head: string[]; rows: string[][] }): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(table.head), ...table.rows.map(line)].filter((l) => l !== "|  |").join("\n");
}
