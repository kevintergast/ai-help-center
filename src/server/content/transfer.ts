import type { ArticleVideo } from "@/lib/content/types";
import { blockTexts, serializeBody } from "@/lib/content/blocks";
import { MAX_IMAGES_PER_ARTICLE, type TransferArticle } from "./store";

/**
 * BILDER IM TRANSFER: Binärdaten reisen NICHT mit (R2-Objekte bleiben in der
 * Quell-Instanz) — wohl aber die BESCHREIBUNGEN. Beim Import werden sie zu
 * VORMERKUNGEN (`pending`): der Artikel weiß, welche Bilder ihm noch fehlen,
 * der Editor bietet „Jetzt hochladen" je Vormerkung an. Im Markdown werden
 * `![Beschreibung](datei)`-Verweise erkannt, extrahiert und vorgemerkt.
 */

/**
 * CONTENT-IMPORT/-EXPORT (Produkt-Bauphase „Content-Werkzeuge"; Anti-Lock-in
 * ist ein Kern-USP): Kunden bekommen ihre Inhalte VOLLSTÄNDIG heraus (JSON,
 * verlustfrei reimportierbar; einzelne Artikel als Markdown) und bringen
 * Bestandsinhalte herein (JSON-Bulk oder Markdown je Artikel).
 *
 * PORTABILITÄT: Querverweise reisen als SLUGS, nie als Instanz-Ids — ein
 * Export lässt sich dadurch in JEDE Instanz importieren (Ids sind dort
 * andere); die Auflösung zurück auf Ids passiert nach dem Import in einem
 * zweiten Pass (api/content.ts).
 *
 * SICHERHEITS-/LIFECYCLE-REGELN: Import legt NEUE Artikel immer als DRAFT an
 * (Veröffentlichen bleibt eine bewusste Handlung und triggert die Index-
 * Hooks); EXISTIERENDE Artikel (gleicher Slug) bekommen ein Inhalts-Update
 * ohne Status-Änderung. Bodies bleiben reine DATEN (string[]-Absätze, kein
 * HTML-Rendering auf API-Ebene).
 */

export const EXPORT_FORMAT = "hallofhelp/articles@1" as const;
export const MAX_IMPORT_ARTICLES = 200;
const MAX_MARKDOWN_CHARS = 200_000;

export interface ExportedArticle {
  slug: string;
  title: string;
  category: string;
  locale: string;
  status: "draft" | "published";
  /** Mixed: Strings (Standard-Text) + typisierte Blöcke (blocks.ts). */
  body: unknown[];
  videos: ArticleVideo[];
  /** Querverweise als Slugs (portabel; Ids sind instanz-spezifisch). */
  relatedSlugs: string[];
  readingMinutes: number;
  /** Bild-BESCHREIBUNGEN (ohne Binärdaten) → beim Import Vormerkungen. */
  images?: { description: string }[];
}

export interface ArticleExportFile {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  articles: ExportedArticle[];
}

/** Admin-Vollbestand (+locale) → verlustfrei reimportierbare Export-Datei. */
export function buildExportFile(
  articles: TransferArticle[],
  exportedAt: string,
): ArticleExportFile {
  const slugById = new Map(articles.map((a) => [a.id, a.slug]));
  return {
    format: EXPORT_FORMAT,
    exportedAt,
    articles: articles.map((a) => ({
      slug: a.slug,
      title: a.title,
      category: a.category,
      locale: a.locale,
      status: a.lifecycle,
      // Blockform in Speicher-Kanonik (Standard-Text = String) — reimportierbar.
      body: serializeBody(a.body),
      videos: a.videos,
      relatedSlugs: a.relatedIds
        .map((id) => slugById.get(id))
        .filter((s): s is string => typeof s === "string"),
      readingMinutes: a.readingMinutes,
      images: (a.images ?? []).map((i) => ({ description: i.description })),
    })),
  };
}

/**
 * Einzelner Artikel → Markdown (Front-Matter mit slug/category/locale,
 * H1-Titel, Absätze durch Leerzeilen). Videos werden als Referenz-Zeilen
 * exportiert (Markdown ist das menschenlesbare Format; das verlustfreie
 * Roundtrip-Format bleibt JSON).
 */
export function articleToMarkdown(a: TransferArticle): string {
  const lines = [
    "---",
    `slug: ${a.slug}`,
    `category: ${a.category}`,
    `locale: ${a.locale}`,
    "---",
    "",
    `# ${a.title}`,
    "",
    blockTexts(a.body).join("\n\n"),
  ];
  if (a.videos.length > 0) {
    lines.push("", "## Videos", "");
    for (const v of a.videos) lines.push(`- ${v.title} (${v.durationLabel}): ${v.description}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export interface ParsedMarkdownArticle {
  slug: string | null;
  title: string;
  category: string | null;
  locale: string | null;
  body: string[];
  /** Aus `![Beschreibung](…)`-Verweisen extrahiert → Bild-Vormerkungen. */
  images: string[];
}

/** `![alt](url)`-Verweise (Markdown-Bild-Syntax; url wird verworfen). */
const MD_IMAGE_RE = /!\[([^\]]*)\]\([^)]*\)/g;

/**
 * Bild-Verweise aus einem Block ziehen: Alt-Text wird zur Vormerkungs-
 * Beschreibung (leer → "Bild"), der Verweis verschwindet aus dem Text —
 * das Rich-Text-Subset kennt keine Bild-Syntax, der Rest bliebe Kauderwelsch.
 */
function extractImages(block: string): { text: string; images: string[] } {
  const images: string[] = [];
  const text = block
    .replace(MD_IMAGE_RE, (_m, alt: string) => {
      images.push(alt.trim().length > 0 ? alt.trim() : "Bild");
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, images };
}

/**
 * Markdown → Artikel-Rohdaten. Erwartet optional Front-Matter (`key: value`
 * zwischen `---`-Zeilen), zwingend GENAU EINEN H1 (`# Titel`); alle weiteren
 * Blöcke (durch Leerzeilen getrennt) werden zu Absätzen. Überschriften ab H2
 * bleiben als Text-Absätze erhalten (ohne `#`-Präfix) — das Absatz-Modell
 * kennt (noch) keine Zwischenüberschriften.
 */
export function parseMarkdownArticle(md: string): ParsedMarkdownArticle | string {
  if (typeof md !== "string" || md.trim().length === 0) return "markdown_empty";
  if (md.length > MAX_MARKDOWN_CHARS) return "markdown_too_large";

  let rest = md.replace(/\r\n/g, "\n");
  const meta: Record<string, string> = {};

  const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(rest);
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/.exec(line.trim());
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
    }
    rest = rest.slice(fmMatch[0].length);
  }

  let title = meta.title ?? null;
  const blocks: string[] = [];
  const images: string[] = [];
  const pushBlock = (raw: string) => {
    // Bild-Verweise → Vormerkungen; Block nur behalten, wenn Text übrig ist.
    const extracted = extractImages(raw);
    images.push(...extracted.images);
    if (extracted.text.length > 0) blocks.push(extracted.text);
  };
  for (const rawBlock of rest.split(/\n\s*\n/)) {
    const block = rawBlock.trim();
    if (block.length === 0) continue;
    const h1 = /^#\s+(.+)$/.exec(block.split("\n")[0]);
    if (h1 && title === null) {
      title = h1[1].trim();
      // Rest des H1-Blocks (falls Text direkt darunter) als eigener Block.
      const tail = block.split("\n").slice(1).join("\n").trim();
      if (tail.length > 0) pushBlock(tail);
      continue;
    }
    // Blöcke VERBATIM erhalten: `##`/`###`/`-`/`1.`/`>`/``` sind exakt das
    // Rich-Text-Subset (rich-text.ts) — kein Marker-Strippen mehr, damit
    // Struktur beim Import erhalten bleibt (Anti-Lock-in-Roundtrip).
    pushBlock(block);
  }

  if (!title || title.length === 0) return "markdown_title_missing";
  if (blocks.length === 0) return "markdown_body_missing";

  return {
    slug: meta.slug ?? null,
    title,
    category: meta.category ?? null,
    locale: meta.locale ?? null,
    body: blocks,
    images,
  };
}

export interface RawImportArticle {
  slug?: unknown;
  title?: unknown;
  category?: unknown;
  locale?: unknown;
  body?: unknown;
  videos?: unknown;
  relatedSlugs?: unknown;
  readingMinutes?: unknown;
  images?: unknown;
}

/**
 * Bild-BESCHREIBUNGEN eines Import-Artikels einsammeln — akzeptiert sowohl
 * die Export-Form `{ description }` als auch nackte Strings (Markdown-Pfad).
 * Gedeckelt auf das Artikel-Bildlimit; Müll wird still verworfen (Bilder
 * sind Beiwerk, sie dürfen den Artikel-Import nie scheitern lassen).
 */
export function parseImportImageDescriptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const desc =
      typeof entry === "string" ? entry : (entry as { description?: unknown } | null)?.description;
    if (typeof desc === "string") {
      const d = desc.trim().slice(0, 500);
      if (d.length > 0) out.push(d);
    }
    if (out.length >= MAX_IMAGES_PER_ARTICLE) break;
  }
  return out;
}

/**
 * Import-Datei prüfen (Format-Kennung + Bestandsgrenze). Die Detail-
 * Validierung JE Artikel übernimmt parseCreateArticle in der Route —
 * dieselben Grenzen wie beim manuellen Anlegen, keine zweite Wahrheit.
 */
export function parseImportFile(raw: unknown): RawImportArticle[] | string {
  if (typeof raw !== "object" || raw === null) return "invalid_import_file";
  const o = raw as { format?: unknown; articles?: unknown };
  if (o.format !== EXPORT_FORMAT) return "unsupported_format";
  if (!Array.isArray(o.articles) || o.articles.length === 0) return "import_empty";
  if (o.articles.length > MAX_IMPORT_ARTICLES) return "import_too_large";
  return o.articles as RawImportArticle[];
}

