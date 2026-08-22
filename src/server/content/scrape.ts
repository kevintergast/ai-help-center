import type { ArticleBlock } from "@/lib/content/blocks";
import { parseYouTubeId } from "./validate";

/**
 * IMPORT PER URL („Bestandsinhalte übernehmen"): Eine Hilfeartikel-Seite wird
 * geladen, in unser BLOCK-Modell übersetzt und als Entwurf importiert —
 * inklusive Bildern (werden heruntergeladen) und YouTube-Videos, in der
 * ORIGINAL-REIHENFOLGE des Artikels.
 *
 * Warum HTML-Parsing reicht: Hilfe-Seiten sind serverseitig gerendert
 * (verifiziert an help.smao.ai: `<article>`, Überschriften, Absätze, Bilder
 * mit Alt-Text, YouTube-iframes). Für rein client-gerenderte Seiten liefert
 * der Parser wenig — dann bleibt der Markdown-/JSON-Import.
 *
 * SICHERHEIT
 *  - SSRF: `assertImportableUrl` erlaubt nur http/https auf öffentliche
 *    Hostnamen — localhost, IP-Literale (inkl. Cloud-Metadaten 169.254.x)
 *    und exotische Ports werden abgelehnt.
 *  - Kein HTML wird gerendert: Wir extrahieren TEXT + unser Markdown-Subset,
 *    Roh-HTML fließt nie in den Body (Blöcke sind Daten, s. blocks.ts).
 *  - Fremde Skripte/Styles werden vor dem Parsen entfernt.
 */

/** Platzhalter-Id im Block, bis das Bild wirklich in R2 liegt. */
export interface ScrapedImage {
  placeholderId: string;
  /** Absolute Quell-URL. */
  url: string;
  /** Alt-Text = Bildbeschreibung (Pflichtfeld bei uns). */
  description: string;
}

export interface ScrapedVideo {
  /** Entwurfs-Id des Video-Eintrags (wird so in den Block geschrieben). */
  id: string;
  youtubeId: string;
}

export interface ScrapedArticle {
  title: string;
  blocks: ArticleBlock[];
  images: ScrapedImage[];
  videos: ScrapedVideo[];
  /** Hinweise fürs Team (z. B. Bilder ohne Alt-Text). */
  warnings: string[];
}

const MAX_BLOCKS = 200;
const MAX_IMAGES = 12;
const MAX_VIDEOS = 10;

/** Nur öffentliche http(s)-Ziele (SSRF-Schutz). */
export function assertImportableUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "invalid_url" };
  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    return { ok: false, error: "url_not_allowed" };
  }
  const host = url.hostname.toLowerCase();
  // Kein localhost, keine IP-Literale (v4/v6), kein *.local / *.internal.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.includes(":") ||
    host.startsWith("[")
  ) {
    return { ok: false, error: "url_not_allowed" };
  }
  if (!host.includes(".")) return { ok: false, error: "url_not_allowed" };
  return { ok: true, url };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Rausch-Elemente entfernen (Navigation, Skripte, Buttons, Icons …). */
function stripNoise(html: string): string {
  let out = html;
  for (const tag of ["script", "style", "nav", "aside", "header", "footer", "button", "form", "svg", "noscript"]) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"), " ");
  }
  return out;
}

/**
 * Inline-Auszeichnung → unser Markdown-Subset (rich-text.ts): Links, fett,
 * kursiv, Code. Alle übrigen Tags fallen weg, Entities werden dekodiert.
 */
function inlineToMarkdown(html: string, baseUrl: URL): string {
  let s = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `**${clean(stripTags(inner))}**`)
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `*${clean(stripTags(inner))}*`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => `\`${clean(stripTags(inner))}\``);

  // Links: Text behalten, URL absolut machen; nur http(s) übernehmen.
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const text = clean(stripTags(inner));
    if (text.length === 0) return "";
    try {
      const abs = new URL(decodeEntities(href), baseUrl);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return text;
      return `[${text}](${abs.toString()})`;
    } catch {
      return text;
    }
  });
  return decodeEntities(stripTags(s));
}

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, "");

/** Mehrzeilige Absätze erhalten (Zeilenumbrüche aus <br>), Rest glätten. */
function tidyText(s: string): string {
  return s
    .split("\n")
    .map((line) => clean(line))
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * HTML → Artikel im Block-Modell. `baseUrl` löst relative Bild-/Link-Pfade auf.
 */
export function extractArticleFromHtml(html: string, baseUrl: URL): ScrapedArticle {
  const warnings: string[] = [];
  const doc = stripNoise(html);

  // Inhalts-Container: <article> bevorzugt, sonst <main>, sonst alles.
  const container =
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(doc)?.[1] ??
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(doc)?.[1] ??
    doc;

  // Titel: erstes h1 im Container/Dokument, sonst <title> (Suffix „| Marke" weg).
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(container) ?? /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(doc);
  const rawTitle = h1
    ? clean(stripTags(decodeEntities(h1[1])))
    : clean(stripTags(decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")))
        .split("|")[0]
        .trim();

  const blocks: ArticleBlock[] = [];
  const images: ScrapedImage[] = [];
  const videos: ScrapedVideo[] = [];
  let imageCounter = 0;
  let videoCounter = 0;

  // Block-Elemente in DOKUMENT-Reihenfolge (die Reihenfolge ist das Ziel).
  const blockRe =
    /<(h2|h3|h4)\b[^>]*>([\s\S]*?)<\/\1>|<p\b[^>]*>([\s\S]*?)<\/p>|<(ul|ol)\b[^>]*>([\s\S]*?)<\/\4>|<pre\b[^>]*>([\s\S]*?)<\/pre>|<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>|<img\b([^>]*)>|<iframe\b([^>]*)>/gi;

  const pushText = (text: string) => {
    const t = tidyText(text);
    if (t.length > 0 && blocks.length < MAX_BLOCKS) {
      blocks.push({ type: "text", variant: "standard", text: t });
    }
  };

  for (const m of container.matchAll(blockRe)) {
    if (blocks.length >= MAX_BLOCKS) break;
    const [, hTag, hInner, pInner, listTag, listInner, preInner, quoteInner, imgAttrs, frameAttrs] = m;

    if (hTag) {
      const level = hTag.toLowerCase() === "h2" ? "## " : "### ";
      const text = clean(inlineToMarkdown(hInner, baseUrl));
      if (text.length > 0) pushText(`${level}${text}`);
    } else if (pInner !== undefined) {
      pushText(inlineToMarkdown(pInner, baseUrl));
    } else if (listTag) {
      const ordered = listTag.toLowerCase() === "ol";
      const items = [...listInner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((li) => clean(inlineToMarkdown(li[1], baseUrl)))
        .filter((t) => t.length > 0);
      if (items.length > 0) {
        pushText(items.map((t, i) => (ordered ? `${i + 1}. ${t}` : `- ${t}`)).join("\n"));
      }
    } else if (preInner !== undefined) {
      const code = decodeEntities(stripTags(preInner)).replace(/^\n+|\n+$/g, "");
      if (code.trim().length > 0 && blocks.length < MAX_BLOCKS) {
        blocks.push({ type: "text", variant: "code", text: code });
      }
    } else if (quoteInner !== undefined) {
      const text = clean(inlineToMarkdown(quoteInner, baseUrl));
      if (text.length > 0) pushText(`> ${text}`);
    } else if (imgAttrs !== undefined) {
      const src = /src="([^"]+)"/i.exec(imgAttrs)?.[1];
      if (!src) continue;
      let abs: URL;
      try {
        abs = new URL(decodeEntities(src), baseUrl);
      } catch {
        continue;
      }
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue; // data:-URIs raus
      if (images.length >= MAX_IMAGES) {
        warnings.push("image_limit");
        continue;
      }
      const alt = clean(decodeEntities(/alt="([^"]*)"/i.exec(imgAttrs)?.[1] ?? ""));
      if (alt.length === 0) warnings.push("image_without_alt");
      const placeholderId = `scraped-image-${++imageCounter}`;
      images.push({
        placeholderId,
        url: abs.toString(),
        // Beschreibung ist bei uns Pflicht (Alt-Text + KI-Kontext).
        description: alt.length > 0 ? alt : `Bild ${imageCounter} (Beschreibung bitte ergänzen)`,
      });
      blocks.push({ type: "image", imageId: placeholderId });
    } else if (frameAttrs !== undefined) {
      const src = /src="([^"]+)"/i.exec(frameAttrs)?.[1];
      if (!src) continue;
      const youtubeId = parseYouTubeId(decodeEntities(src));
      if (!youtubeId) {
        warnings.push("embed_skipped");
        continue;
      }
      if (videos.length >= MAX_VIDEOS) continue;
      const id = `scraped-video-${++videoCounter}`;
      videos.push({ id, youtubeId });
      blocks.push({ type: "video", videoId: id });
    }
  }

  return {
    title: rawTitle.length > 0 ? rawTitle.slice(0, 200) : "",
    blocks,
    images,
    videos,
    warnings: [...new Set(warnings)],
  };
}

/** Slug aus der Quell-URL ableiten (letztes Pfadsegment, sonst Host). */
export function slugFromUrl(url: URL): string {
  const raw = url.pathname.split("/").filter(Boolean).pop() ?? url.hostname;
  // URL-Pfade sind prozent-kodiert („%C3%9Cber") — erst dekodieren, sonst
  // stehen die Bytes im Slug (Test-Fund 2026-08-22).
  let last: string;
  try {
    last = decodeURIComponent(raw);
  } catch {
    last = raw;
  }
  return last
    .toLowerCase()
    .replace(/\.(html?|php)$/, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
