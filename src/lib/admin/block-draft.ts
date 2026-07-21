import type { ArticleBlock } from "@/lib/content/blocks";
import type { ArticleImage, ArticleVideo } from "@/lib/content/types";

/**
 * PURE Draft-Helfer des WYSIWYG-Block-Editors.
 *
 * VIDEO-KOPPLUNG: Video-Einträge (draft.videos, Publish-Zyklus) werden im
 * neuen Editor AUSSCHLIESSLICH über Video-Blöcke gepflegt — der Eintrag
 * „gehört" seinem Block. Beim Entfernen eines Video-Blocks verschwindet der
 * Eintrag mit, AUSSER ein anderer Block referenziert dieselbe videoId noch.
 * Bilder hängen dagegen am SOFORT-Zyklus (R2-Upload) — Blöcke referenzieren
 * sie nur; Waisen sammelt `unplacedAttachments` für die Verwaltungs-Leiste.
 */

export interface EditorBlock {
  /** Stabile Client-Id (Remount-Keys, Edit-Zustand; NICHT persistiert). */
  uid: string;
  block: ArticleBlock;
}

export const wrapBlocks = (blocks: ArticleBlock[]): EditorBlock[] =>
  blocks.map((block) => ({ uid: crypto.randomUUID(), block }));

/** Block an Position einfügen; liefert die uid fürs direkte Öffnen im Edit-Zustand. */
export function insertBlockAt(
  list: EditorBlock[],
  index: number,
  block: ArticleBlock,
): { next: EditorBlock[]; uid: string } {
  const uid = crypto.randomUUID();
  const at = Math.max(0, Math.min(index, list.length));
  return { next: [...list.slice(0, at), { uid, block }, ...list.slice(at)], uid };
}

export function moveBlock(list: EditorBlock[], index: number, dir: -1 | 1): EditorBlock[] {
  const j = index + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/**
 * Block entfernen — Video-Einträge werden mit ausgeräumt, wenn kein anderer
 * Block sie mehr referenziert (sonst blieben unsichtbare Draft-Leichen, die
 * beim Veröffentlichen wieder als „nicht platziert" auftauchen).
 */
export function removeBlockAt(
  list: EditorBlock[],
  index: number,
  videos: ArticleVideo[],
): { blocks: EditorBlock[]; videos: ArticleVideo[] } {
  const removed = list[index]?.block;
  const blocks = list.filter((_, i) => i !== index);
  if (removed?.type !== "video") return { blocks, videos };
  const stillReferenced = blocks.some(
    (w) => w.block.type === "video" && w.block.videoId === removed.videoId,
  );
  return {
    blocks,
    videos: stillReferenced ? videos : videos.filter((v) => v.id !== removed.videoId),
  };
}

/**
 * Video-Eintrag eines Video-Blocks setzen/ersetzen (Inline-Formular im Block):
 * Der alte Eintrag des Blocks fliegt raus, wenn ihn kein anderer Block nutzt;
 * der Block referenziert danach den neuen Eintrag.
 */
export function upsertVideoForBlock(
  list: EditorBlock[],
  uid: string,
  videos: ArticleVideo[],
  video: ArticleVideo,
): { blocks: EditorBlock[]; videos: ArticleVideo[] } {
  const target = list.find((w) => w.uid === uid);
  const oldId = target?.block.type === "video" ? target.block.videoId : null;
  const oldStillUsed =
    oldId !== null &&
    list.some((w) => w.uid !== uid && w.block.type === "video" && w.block.videoId === oldId);

  const nextVideos = [
    ...videos.filter((v) => v.id !== video.id && (oldStillUsed || v.id !== oldId)),
    video,
  ];
  const blocks = list.map((w) =>
    w.uid === uid ? { ...w, block: { type: "video" as const, videoId: video.id } } : w,
  );
  return { blocks, videos: nextVideos };
}

/** Anhänge, die KEIN Block platziert (Alt-Galerie, Import-Vormerkungen, Waisen). */
export function unplacedAttachments(
  list: EditorBlock[],
  images: ArticleImage[],
  videos: ArticleVideo[],
): { images: ArticleImage[]; videos: ArticleVideo[] } {
  const imageIds = new Set<string>();
  const videoIds = new Set<string>();
  for (const w of list) {
    if (w.block.type === "image") imageIds.add(w.block.imageId);
    else if (w.block.type === "video") videoIds.add(w.block.videoId);
  }
  return {
    images: images.filter((i) => !imageIds.has(i.id)),
    videos: videos.filter((v) => !videoIds.has(v.id)),
  };
}
