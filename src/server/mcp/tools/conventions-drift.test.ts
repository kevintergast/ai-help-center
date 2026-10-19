import { describe, expect, it } from "vitest";
import { validateBodyInput } from "@/lib/content/blocks";
import { getContentConventions } from "./read";

/**
 * DRIFT zwischen Dokumentation und Schreibpfad.
 *
 * Am 25.09.2026 beschrieb `get_content_conventions` den Support-Baustein,
 * während `update_article` ihn mit `invalid_body` ablehnte — die Block-Art
 * war nur im toleranten Lesepfad ergänzt worden. 21 vorbereitete Artikel
 * eines Kunden waren dadurch unspeicherbar, und der Fehler fiel erst beim
 * Kunden auf.
 *
 * Dieser Test prüft die REGEL statt eines Einzelfalls: Was der MCP-Server
 * als Baustein dokumentiert, muss der strenge Schreibpfad annehmen. Ein
 * neuer Block-Typ, der nur an einer der beiden Stellen landet, scheitert
 * hier — unabhängig davon, ob jemand daran denkt, einen Test zu schreiben.
 */

interface DocumentedBlock {
  type: string;
  shape: Record<string, unknown>;
}

async function documentedBlocks(): Promise<DocumentedBlock[]> {
  const res = (await getContentConventions.handler(
    {},
    // Der Handler liest aus dem Kontext nur die Sprache der Instanz.
    { tenant: { defaultLocale: "de" } } as never,
  )) as { content: { text: string }[] };
  const parsed = JSON.parse(res.content[0].text) as {
    body: { blocks: DocumentedBlock[] };
  };
  return parsed.body.blocks;
}

describe("get_content_conventions ↔ validateBodyInput", () => {
  it("jede dokumentierte Block-Art ist auch speicherbar", async () => {
    const blocks = await documentedBlocks();
    expect(blocks.length).toBeGreaterThan(5);

    const rejected: { type: string; error: string }[] = [];
    for (const b of blocks) {
      // `shape` ist das Beispiel aus der Dokumentation — exakt das, was ein
      // KI-Client danach schickt. Platzhalter-Ids (<id …>) sind dabei egal:
      // Der Schreibpfad prüft die Form, nicht die Existenz.
      const res = validateBodyInput([b.shape]);
      if (!res.ok) rejected.push({ type: b.type, error: res.error });
    }
    expect(rejected).toEqual([]);
  });

  it("die Beispiele sind vollständig, nicht nur formal gültig", async () => {
    const blocks = await documentedBlocks();
    for (const b of blocks) {
      expect(b.shape.type, `Beispiel für ${b.type} trägt keinen type`).toBe(b.type);
    }
  });
});
