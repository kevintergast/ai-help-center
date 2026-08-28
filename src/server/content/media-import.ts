import type { ArticleBlock } from "@/lib/content/blocks";
import type { ArticleVideo } from "@/lib/content/types";
import { sniffImageType } from "@/server/branding/validate";
import { articleImageKey, type ContentDeps } from "./store";
import { assertImportableUrl, type ScrapedArticle } from "./scrape";
import { fetchVideoTitle, type FetchLike } from "./video-meta";

/**
 * MEDIEN-ÜBERNAHME (Bilder + Videos) — die EINZIGE Stelle, an der ein fremdes
 * Bild bei uns in R2 landet und aus einem gescrapten YouTube-Verweis ein
 * echter Video-Eintrag wird.
 *
 * WARUM GETEILT: Es gibt zwei Türen zum selben Haus — die REST-Route (Mensch
 * mit Session, `api/content.ts`) und der MCP-Server (Maschine mit Schlüssel,
 * `mcp/tools/write.ts`). Der MCP-Import hat die Bilder ursprünglich NICHT
 * geladen und die Video-Einträge gar nicht angelegt: Der Body zeigte auf Ids,
 * die es nicht gab. Solche Blöcke rendern als `null` (article-blocks-view.tsx)
 * — der Verlust war also unsichtbar, der Artikel „sah nur kürzer aus".
 * Eine gemeinsame Funktion kann man nicht an einer Tür vergessen.
 *
 * SICHERHEIT
 *  - SSRF: `assertImportableUrl` vor JEDEM Netzzugriff (kein localhost, keine
 *    IP-Literale, nur http/https auf Standard-Ports).
 *  - Der Inhaltstyp kommt aus den BYTES (`sniffImageType`), nie aus dem
 *    `content-type` der fremden Antwort — dieselbe Regel wie beim Upload.
 *  - Harter Größendeckel; scheitert das Speichern danach, wird das R2-Objekt
 *    wieder entfernt (kein verwaister Blob).
 */

/** 2 MB (Logo: 1 MB — Inhaltsbilder dürfen größer sein). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMPORT_USER_AGENT = "HallofHelpImporter/1.0 (+https://hallofhelp.com)";
export const IMPORT_FETCH_TIMEOUT_MS = 15_000;

/** Stabile, maschinenlesbare Codes — MCP-Tools reichen sie unverändert durch. */
export type ImageImportError =
  | "invalid_url"
  | "url_not_allowed"
  | "media_unavailable"
  | "fetch_failed"
  | "image_too_large"
  | "unsupported_image_type"
  | "not_found"
  | "too_many_images";

export type ImageImportResult =
  | { ok: true; imageId: string }
  | { ok: false; error: ImageImportError };

/**
 * Ein Bild von einer öffentlichen Adresse holen und an den Artikel hängen.
 * `description` ist Pflicht (a11y + KI-Grounding) und wird vom Aufrufer
 * geprüft — hier wird sie nur durchgereicht.
 */
export async function importImageFromUrl(
  content: ContentDeps,
  tenantId: string,
  articleId: string,
  input: { url: string; description: string },
  fetchImpl: FetchLike = fetch,
): Promise<ImageImportResult> {
  const check = assertImportableUrl(input.url);
  if (!check.ok) {
    return { ok: false, error: check.error === "url_not_allowed" ? "url_not_allowed" : "invalid_url" };
  }
  if (!content.media) return { ok: false, error: "media_unavailable" };

  let bytes: Uint8Array;
  try {
    const res = await fetchImpl(check.url.toString(), {
      headers: { "user-agent": IMPORT_USER_AGENT },
      signal: AbortSignal.timeout(IMPORT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: "fetch_failed" };
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return { ok: false, error: "fetch_failed" };
  }

  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: "image_too_large" };
  const sniffed = sniffImageType(bytes);
  if (!sniffed) return { ok: false, error: "unsupported_image_type" };

  const image = { id: crypto.randomUUID(), description: input.description };
  const key = articleImageKey(tenantId, articleId, image.id);
  await content.media.put(key, bytes, { httpMetadata: { contentType: sniffed } });

  const added = await content.store.addImage(tenantId, articleId, image);
  if (added !== "ok") {
    await content.media.delete(key);
    return { ok: false, error: added === "limit" ? "too_many_images" : "not_found" };
  }
  return { ok: true, imageId: image.id };
}

/**
 * Gescrapte YouTube-Verweise → echte Video-Einträge (mit Titel über oEmbed).
 * Die Platzhalter-Ids aus dem Body werden auf die neuen Ids abgebildet.
 */
export async function resolveScrapedVideos(
  scraped: ScrapedArticle,
  fetchImpl: FetchLike = fetch,
): Promise<{ videos: ArticleVideo[]; idByPlaceholder: Map<string, string> }> {
  const idByPlaceholder = new Map<string, string>();
  const videos: ArticleVideo[] = [];
  for (const v of scraped.videos) {
    const title = (await fetchVideoTitle(v.youtubeId, fetchImpl)) ?? `Video ${videos.length + 1}`;
    const id = crypto.randomUUID();
    idByPlaceholder.set(v.id, id);
    // Beschreibung ist Pflicht. Der Titel ist der ehrlichste Startwert — eine
    // echte Beschreibung setzt danach ein Mensch im Editor oder das
    // Client-LLM per `update_article`.
    videos.push({ id, title, durationLabel: "", description: title, youtubeId: v.youtubeId });
  }
  return { videos, idByPlaceholder };
}

/** Platzhalter-Video-Ids im Body durch die echten Ids ersetzen. */
export function applyVideoIds(
  blocks: ArticleBlock[],
  idByPlaceholder: Map<string, string>,
): ArticleBlock[] {
  return blocks.map((b) =>
    b.type === "video" ? { ...b, videoId: idByPlaceholder.get(b.videoId) ?? b.videoId } : b,
  );
}

/**
 * Alle gescrapten Bilder eines Artikels laden und die Platzhalter im Body
 * durch die echten Ids ersetzen. Ein einzelnes Bild, das nicht lädt, kippt den
 * Import NICHT — sein Block fällt weg, damit nie ein Block auf ein fehlendes
 * Bild zeigt (der würde unsichtbar rendern und den Verlust verstecken).
 */
export async function downloadScrapedImages(
  content: ContentDeps,
  tenantId: string,
  articleId: string,
  scraped: ScrapedArticle,
  blocks: ArticleBlock[],
  fetchImpl: FetchLike = fetch,
): Promise<{
  blocks: ArticleBlock[];
  imported: number;
  failed: number;
  /** Warum ein Bild nicht ankam — sonst steht da nur „2 fehlgeschlagen". */
  failures: { url: string; error: ImageImportError }[];
}> {
  const realIds = new Map<string, string>();
  const failures: { url: string; error: ImageImportError }[] = [];
  for (const img of scraped.images) {
    const res = await importImageFromUrl(
      content,
      tenantId,
      articleId,
      { url: img.url, description: img.description },
      fetchImpl,
    );
    if (res.ok) realIds.set(img.placeholderId, res.imageId);
    else failures.push({ url: img.url, error: res.error });
  }

  const out = blocks
    .map((b) => (b.type === "image" ? { ...b, imageId: realIds.get(b.imageId) ?? "" } : b))
    .filter((b) => b.type !== "image" || b.imageId.length > 0);

  return { blocks: out, imported: realIds.size, failed: failures.length, failures };
}
