/**
 * FRAGE-VORSCHLÄGE unter der KI-Eingabe (Migration 0044).
 *
 * Sie sind das Erste, was jemand liest, der noch nicht weiß, was er fragen
 * soll — und damit eine Aussage darüber, wofür das Hilfezentrum da ist.
 * Vorher standen dort für jede Instanz UNSERE Beispielfragen.
 *
 * Geprüft wird hier, damit Verwaltungsbereich und MCP dieselbe Grenze ziehen.
 */

/** Vier passen in zwei Zeilen. Mehr liest sich als Menü statt als Anregung. */
export const MAX_PROMPT_SUGGESTIONS = 4;
export const MAX_SUGGESTION_LENGTH = 100;

export type PromptSuggestionError = "too_many" | "empty" | "too_long";

export type PromptSuggestionsParseResult =
  | { ok: true; suggestions: string[] }
  | { ok: false; error: PromptSuggestionError; index?: number };

/**
 * Rohe Liste → geprüfte Vorschläge.
 *
 * LEERE EINTRÄGE FALLEN WEG statt einen Fehler auszulösen: Ein leeres Feld in
 * der Oberfläche heißt „den will ich nicht", nicht „hier ist ein Fehler".
 * Ein Eintrag, in dem NUR Leerzeichen stehen, ist dasselbe.
 */
export function parsePromptSuggestions(raw: unknown): PromptSuggestionsParseResult {
  if (!Array.isArray(raw)) return { ok: false, error: "empty" };
  if (raw.length > MAX_PROMPT_SUGGESTIONS) return { ok: false, error: "too_many" };

  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i];
    if (typeof value !== "string") return { ok: false, error: "empty", index: i };
    const text = value.trim().replace(/\s+/g, " ");
    if (text.length === 0) continue;
    if (text.length > MAX_SUGGESTION_LENGTH) return { ok: false, error: "too_long", index: i };
    out.push(text);
  }
  return { ok: true, suggestions: out };
}
