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
  | { type: "video"; videoId: string }
  | {
      type: "articleLink";
      slug: string;
      title: string;
      description: string;
      tag: ArticleTag | null;
    };

const MAX_TEXT_CHARS = 8_000;
const MAX_CARD_TITLE = 120;
const MAX_CARD_DESCRIPTION = 300;
export const MAX_TAG_TEXT = 24;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
    } else if (o.type === "image" && typeof o.imageId === "string") {
      out.push({ type: "image", imageId: o.imageId });
    } else if (o.type === "video" && typeof o.videoId === "string") {
      out.push({ type: "video", videoId: o.videoId });
    } else if (
      o.type === "articleLink" &&
      typeof o.slug === "string" &&
      typeof o.title === "string"
    ) {
      out.push({
        type: "articleLink",
        slug: o.slug,
        title: o.title,
        description: typeof o.description === "string" ? o.description : "",
        tag: parseTagInput(o.tag) ?? null,
      });
    }
  }
  return out;
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
      case "articleLink": {
        const slug = typeof o.slug === "string" ? o.slug.trim() : "";
        const title = typeof o.title === "string" ? o.title.trim() : "";
        const description = typeof o.description === "string" ? o.description.trim() : "";
        if (!SLUG_RE.test(slug) || slug.length > 80) return { ok: false, error: "invalid_card_slug" };
        if (title.length === 0 || title.length > MAX_CARD_TITLE) {
          return { ok: false, error: "invalid_card_title" };
        }
        if (description.length > MAX_CARD_DESCRIPTION) {
          return { ok: false, error: "invalid_card_description" };
        }
        const tag = parseTagInput(o.tag);
        if (tag === undefined) return { ok: false, error: "invalid_tag" };
        out.push({ type: "articleLink", slug, title, description, tag });
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
export function blockTexts(blocks: ArticleBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "text") {
      if (b.text.trim().length > 0) out.push(b.text);
    } else if (b.type === "articleLink") {
      const desc = b.description.trim();
      out.push(`→ ${b.title}${desc.length > 0 ? `: ${desc}` : ""}`);
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
    else if (b.type === "articleLink") out.push(b.title, b.description);
  }
  return out;
}

export function applyTranslatedTexts(blocks: ArticleBlock[], texts: string[]): ArticleBlock[] {
  let i = 0;
  const next = (): string => texts[i++] ?? "";
  return blocks.map((b) => {
    if (b.type === "text" && b.variant !== "code") return { ...b, text: next() };
    if (b.type === "articleLink") return { ...b, title: next(), description: next() };
    return b;
  });
}
