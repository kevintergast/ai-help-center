import { describe, expect, it } from "vitest";
import {
  buildExampleImportFile,
  EXAMPLE_IMPORT_MARKDOWN,
} from "@/lib/content/import-examples";
import {
  buildExportFile,
  parseImportFile,
  parseImportImageDescriptions,
  parseMarkdownArticle,
} from "./transfer";
import type { TransferArticle } from "./store";
import { parseCreateArticle } from "./validate";

/**
 * TRANSFER (Import/Export). Verhinderte Fehlerfälle:
 *  - Die BEISPIELDATEIEN aus dem Import-Dialog driften vom echten Format ab
 *    (Nutzer lädt unser eigenes Beispiel hoch → Fehler = Vertrauensbruch).
 *  - Markdown-Bildverweise gehen still verloren statt als Vormerkung
 *    aufzutauchen, oder hinterlassen Syntax-Müll im Absatztext.
 *  - Export verliert Bild-Beschreibungen (Anti-Lock-in: Beschreibungen sind
 *    KI-Kontext und müssen den Umzug überleben — als Vormerkungen).
 */

describe("Beispieldateien laufen durch die ECHTEN Parser (Anti-Drift)", () => {
  it("JSON-Beispiel: parseImportFile + parseCreateArticle je Artikel ohne Fehler", () => {
    const items = parseImportFile(buildExampleImportFile());
    expect(Array.isArray(items)).toBe(true);
    for (const item of items as Record<string, unknown>[]) {
      const valid = parseCreateArticle(
        {
          slug: item.slug,
          title: item.title,
          category: item.category,
          locale: item.locale,
          body: item.body,
          videos: item.videos ?? [],
          readingMinutes: item.readingMinutes,
        },
        "de",
      );
      expect(valid.ok).toBe(true);
    }
  });

  it("Markdown-Beispiel: parseMarkdownArticle ok, Bild wird zur Vormerkung", () => {
    const parsed = parseMarkdownArticle(EXAMPLE_IMPORT_MARKDOWN);
    expect(typeof parsed).not.toBe("string");
    const md = parsed as Exclude<typeof parsed, string>;
    expect(md.slug).toBe("erste-schritte");
    expect(md.images).toEqual(["Screenshot: Dashboard nach dem ersten Login"]);
    // Der Bild-Block verschwindet restlos aus dem Body:
    expect(md.body.join("\n")).not.toContain("![");
    expect(parseCreateArticle({ ...md, videos: [] }, "de").ok).toBe(true);
  });
});

describe("parseMarkdownArticle — Bild-Extraktion", () => {
  it("standalone-Bildblock verschwindet; inline-Bild wird aus dem Text entfernt; leerer Alt → 'Bild'", () => {
    const md = [
      "# Titel",
      "",
      "Absatz mit ![Inline-Schema](x.png) mittendrin.",
      "",
      "![Nur ein Bild](foo.jpg)",
      "",
      "![](ohne-alt.png)",
      "",
      "Letzter Absatz.",
    ].join("\n");
    const parsed = parseMarkdownArticle(md) as Exclude<
      ReturnType<typeof parseMarkdownArticle>,
      string
    >;
    expect(parsed.images).toEqual(["Inline-Schema", "Nur ein Bild", "Bild"]);
    expect(parsed.body).toEqual(["Absatz mit  mittendrin.", "Letzter Absatz."]);
  });
});

describe("parseImportImageDescriptions", () => {
  it("akzeptiert {description} UND nackte Strings; trimmt, deckelt, verwirft Müll", () => {
    expect(
      parseImportImageDescriptions([
        { description: "  Screenshot A  " },
        "Screenshot B",
        { description: "" },
        { nope: true },
        42,
        null,
      ]),
    ).toEqual(["Screenshot A", "Screenshot B"]);
    expect(parseImportImageDescriptions("kein-array")).toEqual([]);
    expect(parseImportImageDescriptions(Array.from({ length: 30 }, (_, i) => `B${i}`)).length).toBe(
      12,
    );
  });
});

describe("buildExportFile — Bild-Beschreibungen reisen mit", () => {
  it("echte UND vorgemerkte Bilder landen als {description} im Export", () => {
    const article = {
      id: "a1",
      slug: "s",
      title: "T",
      category: "K",
      status: "current",
      updatedLabel: "x",
      readingMinutes: 1,
      body: ["Absatz"],
      videos: [],
      relatedIds: [],
      images: [
        { id: "i1", description: "Echtes Bild" },
        { id: "i2", description: "Vormerkung aus Import", pending: true },
      ],
      locale: "de",
      lifecycle: "published",
    } as unknown as TransferArticle;
    const file = buildExportFile([article], "2026-01-01T00:00:00.000Z");
    expect(file.articles[0].images).toEqual([
      { description: "Echtes Bild" },
      { description: "Vormerkung aus Import" },
    ]);
  });
});
