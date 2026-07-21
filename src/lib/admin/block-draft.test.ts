import { describe, expect, it } from "vitest";
import type { ArticleVideo } from "@/lib/content/types";
import {
  insertBlockAt,
  moveBlock,
  removeBlockAt,
  unplacedAttachments,
  upsertVideoForBlock,
  wrapBlocks,
} from "./block-draft";

/**
 * Verhinderte Fehlerfälle (WYSIWYG-Editor, Video-Block-Kopplung):
 *  - Entfernter Video-Block hinterlässt einen unsichtbaren Video-Eintrag im
 *    Draft (taucht nach Publish als „nicht platziert" wieder auf) ODER
 *    reißt einen Eintrag weg, den ein ZWEITER Block noch referenziert.
 *  - Einfügen an Position landet am falschen Index (Plus-Linien-Versprechen).
 *  - „Nicht platziert"-Leiste zeigt platzierte Anhänge oder verschluckt Waisen.
 */

const video = (id: string): ArticleVideo => ({
  id,
  title: `Video ${id}`,
  durationLabel: "",
  description: "Beschreibung",
  youtubeId: "dQw4w9WgXcQ",
});

const base = wrapBlocks([
  { type: "text", variant: "standard", text: "A" },
  { type: "video", videoId: "v1" },
  { type: "text", variant: "standard", text: "B" },
]);

describe("insertBlockAt / moveBlock", () => {
  it("fügt exakt an der Plus-Position ein und liefert die uid zum Öffnen", () => {
    const { next, uid } = insertBlockAt(base, 1, { type: "text", variant: "info", text: "X" });
    expect(next.map((w) => (w.block.type === "text" ? w.block.text : "·"))).toEqual([
      "A",
      "X",
      "·",
      "B",
    ]);
    expect(next[1].uid).toBe(uid);
    // Out-of-range wird geklemmt (Plus-Area am Ende).
    expect(insertBlockAt(base, 99, { type: "text", variant: "standard", text: "Z" }).next).toHaveLength(4);
  });

  it("moveBlock tauscht Nachbarn; Ränder sind no-ops", () => {
    expect(moveBlock(base, 0, -1)).toBe(base);
    const moved = moveBlock(base, 0, 1);
    expect(moved[0].block.type).toBe("video");
    expect(moved[1].block).toMatchObject({ text: "A" });
  });
});

describe("removeBlockAt — Video-Kopplung", () => {
  it("entfernt den Video-EINTRAG mit, wenn kein anderer Block ihn referenziert", () => {
    const { blocks, videos } = removeBlockAt(base, 1, [video("v1"), video("v2")]);
    expect(blocks).toHaveLength(2);
    expect(videos.map((v) => v.id)).toEqual(["v2"]);
  });

  it("lässt den Eintrag stehen, wenn ein ZWEITER Block dieselbe videoId nutzt", () => {
    const twice = wrapBlocks([
      { type: "video", videoId: "v1" },
      { type: "video", videoId: "v1" },
    ]);
    const { videos } = removeBlockAt(twice, 0, [video("v1")]);
    expect(videos.map((v) => v.id)).toEqual(["v1"]);
  });

  it("Text-Block entfernen fasst Videos nie an", () => {
    const { videos } = removeBlockAt(base, 0, [video("v1")]);
    expect(videos.map((v) => v.id)).toEqual(["v1"]);
  });
});

describe("upsertVideoForBlock", () => {
  it("ersetzt den Eintrag des Blocks (alter Eintrag verschwindet, Referenz zeigt auf neu)", () => {
    const uid = base[1].uid;
    const { blocks, videos } = upsertVideoForBlock(base, uid, [video("v1")], video("v9"));
    expect(videos.map((v) => v.id)).toEqual(["v9"]);
    expect(blocks[1].block).toEqual({ type: "video", videoId: "v9" });
  });

  it("behält den alten Eintrag, wenn ihn ein anderer Block noch nutzt", () => {
    const twice = wrapBlocks([
      { type: "video", videoId: "v1" },
      { type: "video", videoId: "v1" },
    ]);
    const { videos } = upsertVideoForBlock(twice, twice[0].uid, [video("v1")], video("v9"));
    expect(videos.map((v) => v.id).sort()).toEqual(["v1", "v9"]);
  });
});

describe("unplacedAttachments", () => {
  it("liefert genau die Anhänge OHNE Block-Referenz", () => {
    const images = [
      { id: "i1", description: "platziert" },
      { id: "i2", description: "Waise" },
    ];
    const withImage = wrapBlocks([{ type: "image", imageId: "i1" }]);
    const un = unplacedAttachments(withImage, images, [video("v1")]);
    expect(un.images.map((i) => i.id)).toEqual(["i2"]);
    expect(un.videos.map((v) => v.id)).toEqual(["v1"]);
  });
});
