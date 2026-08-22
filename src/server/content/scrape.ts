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
const MAX_IMAGES = 40;
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
 * Index NACH dem passenden schließenden Tag (zählt Verschachtelung mit) —
 * nötig für Callout-/Text-Container, die weitere divs enthalten.
 */
function endOfElement(html: string, openStart: number, tag: string): number {
  const openRe = new RegExp(`<${tag}\\b`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 0;
  let pos = openStart;
  for (;;) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return html.length;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      pos = nextOpen.index + 1;
      continue;
    }
    depth--;
    pos = nextClose.index + nextClose[0].length;
    if (depth <= 0) return pos;
  }
}

/** Klassennamen, die in Doku-Systemen Hinweis-/Textboxen markieren. */
const CALLOUT_CLASS = /\b(?:alert|callout|note|tip|hint|info|warning|danger|prose)\b/i;
const WARNING_CLASS = /\b(?:warning|caution)\b/i;
const ERROR_CLASS = /\b(?:danger|error|critical)\b/i;

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

  // Blöcke werden MIT Position gesammelt und am Ende sortiert — so bleibt die
  // Original-Reihenfolge auch bei geschachtelten Containern erhalten.
  const found: { pos: number; block: ArticleBlock }[] = [];
  const images: ScrapedImage[] = [];
  const videos: ScrapedVideo[] = [];
  let imageCounter = 0;
  let videoCounter = 0;

  /** Bereiche, die ein Callout-Container schon abgedeckt hat (kein Doppel). */
  const consumed: [number, number][] = [];
  const isConsumed = (at: number) => consumed.some(([a, b]) => at >= a && at < b);

  // (A) CALLOUT-/TEXT-CONTAINER (Import-Fund: Hinweisboxen halten ihren Text
  //     oft in <div> mit <br>-Umbrüchen statt in <p> — der Text ginge sonst
  //     komplett verloren, s. Zendesk-Artikel).
  for (const m of container.matchAll(/<div\b([^>]*)>/gi)) {
    const attrs = m[1] ?? "";
    const cls = /class="([^"]*)"/i.exec(attrs)?.[1] ?? "";
    if (!CALLOUT_CLASS.test(cls)) continue;
    const start = m.index ?? 0;
    if (isConsumed(start)) continue;
    const end = endOfElement(container, start, "div");
    const inner = container.slice(start + m[0].length, end);
    // Enthält der Container eigene Block-Elemente? Dann macht der Hauptlauf
    // die Arbeit (sonst würde derselbe Text zweimal importiert).
    if (/<(?:p|h[1-4]|ul|ol|table|pre|blockquote|img|iframe)\b/i.test(inner)) continue;
    const text = tidyText(inlineToMarkdown(inner, baseUrl));
    if (text.length < 20) continue;
    const variant = ERROR_CLASS.test(cls) ? "error" : WARNING_CLASS.test(cls) ? "warning" : "info";
    found.push({ pos: start, block: { type: "text", variant, text } });
    consumed.push([start, end]);
  }

  // (A2) AUFKLAPPBARE ABSCHNITTE: <details><summary>Titel</summary>…</details>
  //      ist die verbreitete Form in Hilfezentren (FAQ, optionale Details).
  //      Titel + Inhalt landen in EINEM accordion-Block; der Bereich wird als
  //      verbraucht markiert, damit der Hauptlauf den Inhalt nicht doppelt holt.
  for (const m of container.matchAll(/<details\b[^>]*>/gi)) {
    const start = m.index ?? 0;
    if (isConsumed(start)) continue;
    const end = endOfElement(container, start, "details");
    const inner = container.slice(start + m[0].length, end);
    const summary = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner);
    const title = clean(stripTags(decodeEntities(summary?.[1] ?? "")));
    const body = tidyText(inlineToMarkdown(inner.replace(summary?.[0] ?? "", ""), baseUrl));
    if (title.length === 0 && body.length === 0) continue;
    found.push({
      pos: start,
      block: { type: "accordion", title: title.length > 0 ? title : body.slice(0, 80), text: body },
    });
    consumed.push([start, end]);
  }

  // (B) TABELLEN (Import-Fund: Parameter-/Feld-Übersichten gingen verloren).
  for (const m of container.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const start = m.index ?? 0;
    if (isConsumed(start)) continue;
    const inner = m[1];
    const cell = (raw: string) => clean(inlineToMarkdown(raw, baseUrl));
    const head = [...(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(inner)?.[1] ?? "").matchAll(
      /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi,
    )].map((c) => cell(c[1]));
    const bodyHtml = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(inner)?.[1] ?? inner;
    const rows = [...bodyHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((r) => [...r[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => cell(c[1])))
      .filter((r) => r.some((c) => c.length > 0));
    // Kopfzeile ohne <thead>: erste Zeile mit <th> übernehmen.
    const headFromFirstRow =
      head.length === 0 && /<th\b/i.test(inner)
        ? (rows.shift() ?? [])
        : [];
    const finalHead = head.length > 0 ? head : headFromFirstRow;
    if (finalHead.length > 0 || rows.length > 0) {
      found.push({ pos: start, block: { type: "table", head: finalHead, rows } });
      consumed.push([start, start + m[0].length]);
    }
  }

  // Block-Elemente in DOKUMENT-Reihenfolge (die Reihenfolge ist das Ziel).
  const blockRe =
    /<(h2|h3|h4)\b[^>]*>([\s\S]*?)<\/\1>|<p\b[^>]*>([\s\S]*?)<\/p>|<(ul|ol)\b[^>]*>([\s\S]*?)<\/\4>|<pre\b[^>]*>([\s\S]*?)<\/pre>|<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>|<img\b([^>]*)>|<iframe\b([^>]*)>|<(hr)\b[^>]*\/?>/gi;

  const pushText = (pos: number, text: string) => {
    const t = tidyText(text);
    if (t.length > 0 && found.length < MAX_BLOCKS) {
      found.push({ pos, block: { type: "text", variant: "standard", text: t } });
    }
  };

  for (const m of container.matchAll(blockRe)) {
    if (found.length >= MAX_BLOCKS) break;
    const at = m.index ?? 0;
    if (isConsumed(at)) continue; // schon von Callout/Tabelle abgedeckt
    const [, hTag, hInner, pInner, listTag, listInner, preInner, quoteInner, imgAttrs, frameAttrs, hrTag] =
      m;

    if (hrTag) {
      // Trennlinie übernehmen (gliedert lange Artikel, kostet nichts).
      if (found.length < MAX_BLOCKS) found.push({ pos: at, block: { type: "divider" } });
      continue;
    }

    if (hTag) {
      const level = hTag.toLowerCase() === "h2" ? "## " : "### ";
      const text = clean(inlineToMarkdown(hInner, baseUrl));
      if (text.length > 0) pushText(at, `${level}${text}`);
    } else if (pInner !== undefined) {
      pushText(at, inlineToMarkdown(pInner, baseUrl));
    } else if (listTag) {
      const ordered = listTag.toLowerCase() === "ol";
      const items = [...listInner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((li) => clean(inlineToMarkdown(li[1], baseUrl)))
        .filter((t) => t.length > 0);
      if (items.length > 0) {
        pushText(at, items.map((t, i) => (ordered ? `${i + 1}. ${t}` : `- ${t}`)).join("\n"));
      }
    } else if (preInner !== undefined) {
      const code = decodeEntities(stripTags(preInner)).replace(/^\n+|\n+$/g, "");
      if (code.trim().length > 0 && found.length < MAX_BLOCKS) {
        found.push({ pos: at, block: { type: "text", variant: "code", text: code } });
      }
    } else if (quoteInner !== undefined) {
      const text = clean(inlineToMarkdown(quoteInner, baseUrl));
      if (text.length > 0) pushText(at, `> ${text}`);
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
      found.push({ pos: at, block: { type: "image", imageId: placeholderId } });
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
      found.push({ pos: at, block: { type: "video", videoId: id } });
    }
  }

  const blocks = found.sort((a, b) => a.pos - b.pos).map((f) => f.block);

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
