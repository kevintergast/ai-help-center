/**
 * PROMPT-BAU + ANTWORT-PARSING für den dynamischen Hilfeartikel (RAG-Kern).
 * Reine Funktionen (getestet); der eigentliche Modell-Aufruf wird injiziert.
 *
 * Prompt-Grundsätze (Architektur-Trust-Schicht):
 *  - NUR aus den nummerierten Quellen antworten — fehlt die Info, sagen dass
 *    sie fehlt (die Grounding-Schwelle hat davor schon grob gefiltert).
 *  - In der SPRACHE DER FRAGE antworten (Architektur-Entscheidung),
 *  - kurze Absätze, Endnutzer-Ton, kein Markdown-Gerüst (die UI rendert
 *    Absätze als Text — kein Roh-HTML/Markdown-Pfad).
 */

export interface ContextChunk {
  /** 1-basierte Quellen-Nummer im Prompt. */
  index: number;
  articleTitle: string;
  text: string;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export function buildAskMessages(question: string, chunks: ContextChunk[]): ChatMessage[] {
  const sources = chunks
    .map((c) => `[Quelle ${c.index}] (Artikel: ${c.articleTitle})\n${c.text}`)
    .join("\n\n---\n\n");

  return [
    {
      role: "system",
      content:
        "Du bist der Hilfe-Assistent dieses Hilfezentrums. Beantworte die Frage " +
        "AUSSCHLIESSLICH mit Informationen aus den bereitgestellten Quellen. " +
        "Erfinde nichts; fehlt eine Information in den Quellen, sage das offen. " +
        "Antworte IMMER in der Sprache der Frage. Schreibe eine kompakte, " +
        "hilfreiche Antwort in 1–4 kurzen Absätzen, konkret und Schritt für " +
        "Schritt wo sinnvoll. Reiner Fließtext: keine Markdown-Überschriften, " +
        "keine Code-Blöcke, keine Quellen-Nummern im Text.",
    },
    {
      role: "user",
      content: `QUELLEN:\n\n${sources}\n\nFRAGE: ${question}`,
    },
  ];
}

/** Maximal angezeigte Absätze (Schutz vor Modell-Weitschweifigkeit). */
const MAX_PARAGRAPHS = 8;

/**
 * Modelltext → Anzeige-Absätze: an Leerzeilen trennen, Markdown-Reste
 * (Überschriften-#, Listen-Marker, **fett**-Sterne) entschärfen, leere Teile
 * verwerfen. Einzelne Zeilenumbrüche innerhalb eines Absatzes werden zu
 * Leerzeichen (Modelle brechen gern hart um).
 */
export function splitAnswerParagraphs(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.replace(/^\s*(#{1,6}\s+|[-*]\s+|\d+[.)]\s+)/, "").trim())
        .filter((line) => line.length > 0)
        .join(" ")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .trim(),
    )
    .filter((p) => p.length > 0)
    .slice(0, MAX_PARAGRAPHS);
}
