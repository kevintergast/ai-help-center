import { blockTexts, parseTagInput, validateBodyInput, type ArticleBlock, type ArticleFlag } from "@/lib/content/blocks";
import type { ArticleVideo } from "@/lib/content/types";

/**
 * Validierung für Artikel-Pflege (Create/Update) — von Hand, analog zu
 * legal/validate.ts (kein Zod im Projekt). Fehlercodes sind stabile,
 * maschinenlesbare englische Strings.
 *
 * SICHERHEIT: `body` wird als DATEN gespeichert (JSON string[]) und NIE
 * serverseitig zu HTML gerendert → kein XSS-Vektor auf API-Ebene. Sicheres
 * Rendern (Roh-HTML aus) ist Aufgabe der UI, nicht dieser Schicht.
 */

/** Slug: kleingeschrieben, alphanumerisch, Bindestrich-getrennt (kein führender/doppelter/abschließender). */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Reservierte Slugs: sie kollidieren mit expliziten App-Routen, die in Next
 * Vorrang vor dem dynamischen `/<slug>` haben — ein Artikel mit diesem Slug wäre
 * über seine URL nicht erreichbar. Deshalb beim Anlegen hart ablehnen.
 */
export const RESERVED_SLUGS = new Set([
  "login",
  "signup",
  "verify-email",
  "forgot-password",
  "reset-password",
  "mfa",
  "invite",
  "admin",
  "console",
  "help",
  "brandbook",
  "api",
  // Widget-Embed-Fläche (Bauphase Widget): /widget = iframe-Seite.
  "widget",
]);

export const MAX_TITLE_LENGTH = 300;
export const MAX_CATEGORY_LENGTH = 120;
export const MAX_SLUG_LENGTH = 128;
export const MAX_BODY_BLOCKS = 200;
export const MAX_VIDEOS = 20;
export const MAX_RELATED = 50;

/** Persistierbare Nutzlast eines Artikels (Storage-nah, aber transport-agnostisch). */
export interface ArticleInput {
  slug: string;
  title: string;
  category: string;
  locale: string;
  body: ArticleBlock[];
  flag?: ArticleFlag | null;
  videos: ArticleVideo[];
  relatedIds: string[];
  readingMinutes: number;
  isAiGenerated: boolean;
}

/** Teilaktualisierung: nur gesetzte Felder werden geschrieben (Merge im Repo). */
export interface ArticleUpdateInput {
  title?: string;
  category?: string;
  body?: ArticleBlock[];
  /** undefined = unberührt; null = Flag entfernen. */
  flag?: ArticleFlag | null;
  videos?: ArticleVideo[];
  relatedIds?: string[];
  readingMinutes?: number;
  isAiGenerated?: boolean;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: 400 };

const fail = (error: string): { ok: false; error: string; status: 400 } => ({
  ok: false,
  error,
  status: 400,
});

function isNonEmptyString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/** Wörter/200 (min. 1) — grobe Lesezeit, wenn der Client keine mitschickt. */
export function estimateReadingMinutes(body: ArticleBlock[]): number {
  const words = blockTexts(body).join(" ").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Prüft den Body: Strings (Standard-Text) + typisierte Blöcke (blocks.ts). */
function parseBody(value: unknown): ParseResult<ArticleBlock[]> {
  if (!Array.isArray(value)) return fail("invalid_body");
  if (value.length > MAX_BODY_BLOCKS) return fail("body_too_large");
  const parsed = validateBodyInput(value);
  if (!parsed.ok) return fail(parsed.error);
  return { ok: true, value: parsed.value };
}

/**
 * YouTube-Video-ID aus Nutzereingabe extrahieren: akzeptiert die rohe
 * 11-Zeichen-ID sowie die üblichen URL-Formen (watch?v=, youtu.be/, /shorts/,
 * /embed/, /live/ — inkl. m.- und nocookie-Hosts). Alles andere → null.
 * Gespeichert wird IMMER nur die validierte ID (keine rohen URLs im Storage).
 */
export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const idOk = (id: string | null | undefined): string | null =>
    id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;

  if (host === "youtu.be") return idOk(url.pathname.split("/")[1]);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const fromQuery = idOk(url.searchParams.get("v"));
    if (fromQuery) return fromQuery;
    const m = /^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
    return idOk(m?.[1]);
  }
  return null;
}

/**
 * Prüft ein Video-Array. JEDES Video braucht id/title, eine YOUTUBE-Quelle
 * (`youtubeId` ODER `youtubeUrl`, s. parseYouTubeId — v1 ist bewusst nur
 * YouTube) UND eine nicht-leere `description` (a11y/KI-Pflicht — härtester
 * Fail-Punkt der Task). `durationLabel` ist optional (leer = ausgeblendet).
 */
function parseVideos(value: unknown): ParseResult<ArticleVideo[]> {
  if (!Array.isArray(value)) return fail("invalid_videos");
  if (value.length > MAX_VIDEOS) return fail("too_many_videos");
  const out: ArticleVideo[] = [];
  for (const v of value) {
    if (typeof v !== "object" || v === null) return fail("invalid_video");
    const o = v as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.title !== "string" || o.title.trim().length === 0) {
      return fail("invalid_video");
    }
    if (typeof o.description !== "string" || o.description.trim().length === 0) {
      return fail("video_description_required");
    }
    const source =
      typeof o.youtubeId === "string"
        ? o.youtubeId
        : typeof o.youtubeUrl === "string"
          ? o.youtubeUrl
          : null;
    const youtubeId = source === null ? null : parseYouTubeId(source);
    if (!youtubeId) return fail("youtube_url_invalid");
    out.push({
      id: o.id,
      title: o.title.trim(),
      durationLabel: typeof o.durationLabel === "string" ? o.durationLabel.trim() : "",
      description: o.description,
      youtubeId,
    });
  }
  return { ok: true, value: out };
}

function parseRelated(value: unknown): ParseResult<string[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > MAX_RELATED) return fail("invalid_related");
  if (!value.every((r) => typeof r === "string")) return fail("invalid_related");
  return { ok: true, value: value as string[] };
}

/** Vollständige Create-Nutzlast. `locale` fällt auf den übergebenen Default zurück. */
export function parseCreateArticle(body: unknown, defaultLocale: string): ParseResult<ArticleInput> {
  if (typeof body !== "object" || body === null) return fail("invalid_body");
  const b = body as Record<string, unknown>;

  if (typeof b.slug !== "string" || b.slug.length > MAX_SLUG_LENGTH || !SLUG_RE.test(b.slug)) {
    return fail("invalid_slug");
  }
  if (RESERVED_SLUGS.has(b.slug)) return fail("reserved_slug");
  if (!isNonEmptyString(b.title, MAX_TITLE_LENGTH)) return fail("title_required");
  if (!isNonEmptyString(b.category, MAX_CATEGORY_LENGTH)) return fail("category_required");

  const bodyRes = parseBody(b.body ?? []);
  if (!bodyRes.ok) return bodyRes;
  const videosRes = parseVideos(b.videos ?? []);
  if (!videosRes.ok) return videosRes;
  const relatedRes = parseRelated(b.relatedIds);
  if (!relatedRes.ok) return relatedRes;

  const flag = parseTagInput(b.flag);
  if (flag === undefined) return fail("invalid_flag");

  const locale = typeof b.locale === "string" && b.locale.length > 0 ? b.locale : defaultLocale;
  const readingMinutes =
    typeof b.readingMinutes === "number" && b.readingMinutes > 0
      ? Math.floor(b.readingMinutes)
      : estimateReadingMinutes(bodyRes.value);

  return {
    ok: true,
    value: {
      slug: b.slug,
      title: b.title,
      category: b.category,
      locale,
      body: bodyRes.value,
      flag,
      videos: videosRes.value,
      relatedIds: relatedRes.value,
      readingMinutes,
      isAiGenerated: b.isAiGenerated === true,
    },
  };
}

/** Teilaktualisierung: leerer Body ⇒ Fehler (nichts zu ändern). */
export function parseUpdateArticle(body: unknown): ParseResult<ArticleUpdateInput> {
  if (typeof body !== "object" || body === null) return fail("invalid_body");
  const b = body as Record<string, unknown>;
  const out: ArticleUpdateInput = {};

  if (b.title !== undefined) {
    if (!isNonEmptyString(b.title, MAX_TITLE_LENGTH)) return fail("title_required");
    out.title = b.title;
  }
  if (b.category !== undefined) {
    if (!isNonEmptyString(b.category, MAX_CATEGORY_LENGTH)) return fail("category_required");
    out.category = b.category;
  }
  if (b.body !== undefined) {
    const res = parseBody(b.body);
    if (!res.ok) return res;
    out.body = res.value;
    out.readingMinutes = estimateReadingMinutes(res.value);
  }
  if (b.flag !== undefined) {
    const flag = parseTagInput(b.flag);
    if (flag === undefined) return fail("invalid_flag");
    out.flag = flag;
  }
  if (b.videos !== undefined) {
    const res = parseVideos(b.videos);
    if (!res.ok) return res;
    out.videos = res.value;
  }
  if (b.relatedIds !== undefined) {
    const res = parseRelated(b.relatedIds);
    if (!res.ok) return res;
    out.relatedIds = res.value;
  }
  if (typeof b.readingMinutes === "number" && b.readingMinutes > 0) {
    out.readingMinutes = Math.floor(b.readingMinutes);
  }
  if (b.isAiGenerated !== undefined) out.isAiGenerated = b.isAiGenerated === true;

  if (Object.keys(out).length === 0) return fail("empty_update");
  return { ok: true, value: out };
}
