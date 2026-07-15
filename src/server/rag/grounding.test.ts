import { describe, expect, it } from "vitest";
import { assessGrounding, GROUNDING_MIN_SCORE, MAX_CONTEXT_CHUNKS } from "./grounding";
import { buildAskMessages, splitAnswerParagraphs } from "./generate";

/**
 * GROUNDING-SCHWELLE (Pflicht-Testziel lt. CLAUDE.md) + Prompt-/Parsing-Kern.
 * Verhinderte Fehlerfälle:
 *  - Antwort ohne belastbare Quellen (Halluzination statt No-Answer).
 *  - Kontext explodiert (kein Chunk-Deckel) oder enthält Duplikate.
 *  - Modell-Markdown-Reste landen roh in der UI.
 */

const m = (articleId: string, chunkIndex: number, score: number) => ({
  articleId,
  chunkIndex,
  score,
});

describe("assessGrounding", () => {
  it("leer / alles unter der Schwelle → NICHT geerdet (No-Answer statt Halluzination)", () => {
    expect(assessGrounding([]).grounded).toBe(false);
    expect(assessGrounding([m("a", 0, GROUNDING_MIN_SCORE - 0.01)]).grounded).toBe(false);
  });

  it("exakt AN der Schwelle zählt (>=), sortiert absteigend, dedupliziert", () => {
    const result = assessGrounding([
      m("a", 0, GROUNDING_MIN_SCORE),
      m("b", 1, 0.9),
      m("b", 1, 0.8), // Duplikat (gleicher Chunk) → raus
    ]);
    expect(result.grounded).toBe(true);
    expect(result.selected).toEqual([m("b", 1, 0.9), m("a", 0, GROUNDING_MIN_SCORE)]);
  });

  it("kappt auf MAX_CONTEXT_CHUNKS (Prompt-Budget)", () => {
    const many = Array.from({ length: MAX_CONTEXT_CHUNKS + 4 }, (_, i) => m("a", i, 0.9 - i * 0.01));
    expect(assessGrounding(many).selected).toHaveLength(MAX_CONTEXT_CHUNKS);
  });
});

describe("buildAskMessages / splitAnswerParagraphs", () => {
  it("Prompt enthält nummerierte Quellen, Artikel-Titel, Frage und die Kern-Regeln", () => {
    const messages = buildAskMessages("Wie lade ich mein Team ein?", [
      { index: 1, articleTitle: "Team & Rollen", text: "Einladungen verschickt der Admin…" },
    ]);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("AUSSCHLIESSLICH");
    expect(messages[0].content).toContain("Sprache der Frage");
    expect(messages[1].content).toContain("[Quelle 1] (Artikel: Team & Rollen)");
    expect(messages[1].content).toContain("FRAGE: Wie lade ich mein Team ein?");
  });

  it("Absatz-Split: Markdown-Reste raus, harte Umbrüche gejoint, Deckel greift", () => {
    expect(splitAnswerParagraphs("## Titel\nZeile eins\nZeile zwei\n\n- Punkt\n\n**Fett** bleibt Text")).toEqual([
      "Titel Zeile eins Zeile zwei",
      "Punkt",
      "Fett bleibt Text",
    ]);
    const many = Array.from({ length: 20 }, (_, i) => `Absatz ${i}`).join("\n\n");
    expect(splitAnswerParagraphs(many).length).toBeLessThanOrEqual(8);
    expect(splitAnswerParagraphs("   \n\n  ")).toEqual([]);
  });
});
