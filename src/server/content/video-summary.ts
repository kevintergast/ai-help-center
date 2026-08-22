import type { ChatMessage } from "@/server/rag/generate";
import { TRANSCRIPT_PROMPT_CHARS } from "./video-meta";

/**
 * KI-AUFBEREITUNG eines Video-Transkripts → Titel + Beschreibung (Editor).
 *
 * WARUM: Die Video-BESCHREIBUNG ist KI-Kontext — die Frage-Pipeline matcht
 * Nutzerfragen dagegen (toIndexable nimmt sie in die Chunks auf). Von Hand
 * getippte Einzeiler („Rundgang") sind dafür zu dünn; ein 20-Minuten-Video
 * braucht 2–4 Sätze mit den Begriffen, nach denen Nutzer wirklich fragen.
 *
 * ANTI-HALLUZINATION (tragend): Ohne Transkript wird NICHT generiert — der
 * Aufrufer fragt dann nach dem Transkript. Eine erfundene Beschreibung würde
 * in den Index wandern und die KI auf Videos verweisen lassen, die das Thema
 * nie behandeln (Vertrauensbruch, schlimmer als ein leeres Feld).
 */

export interface VideoSummaryInput {
  /** Transkript (bereits normalisiert, s. video-meta.ts). */
  transcript: string;
  /** YouTube-Titel als Kontext/Fallback (oEmbed) — optional. */
  videoTitle?: string | null;
  /** Zielsprache = Instanzsprache. */
  locale: string;
}

export interface VideoSummaryResult {
  title: string;
  description: string;
}

const LANG: Record<string, string> = { de: "Deutsch", en: "Englisch" };
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 600;

export function buildVideoSummaryMessages(input: VideoSummaryInput): ChatMessage[] {
  const language = LANG[input.locale] ?? input.locale;
  const payload = JSON.stringify({
    videoTitle: input.videoTitle ?? null,
    transcript: input.transcript.slice(0, TRANSCRIPT_PROMPT_CHARS),
  });

  return [
    {
      role: "system",
      content:
        "Du bereitest ein Video für ein Hilfezentrum auf. Du bekommst JSON mit videoTitle (kann null sein) " +
        "und transcript (Transkript des Videos). " +
        `Antworte AUSSCHLIESSLICH mit JSON: {"title": "...", "description": "..."} auf ${language}. ` +
        "REGELN: title = kurzer, sachlicher Titel (max. 10 Wörter), der den INHALT benennt — kein Marketing, " +
        "keine Kanal-/Serien-Zusätze; description = 2 bis 4 Sätze, die konkret benennen, welche Aufgaben, " +
        "Funktionen und Begriffe das Video behandelt, damit Suchende es finden. " +
        "Nutze NUR Informationen aus dem Transkript — erfinde nichts, spekuliere nicht über nicht Gezeigtes. " +
        "Keine Zeitangaben, keine Aufzählungszeichen, kein Markdown.",
    },
    { role: "user", content: payload },
  ];
}

/** Modellantwort → validiertes Ergebnis; wirft bei unbrauchbarer Form. */
export function parseVideoSummaryResponse(raw: string): VideoSummaryResult {
  // Modelle rahmen JSON gern mit Prosa/Codefences → größten JSON-Block nehmen.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("video-summary: kein JSON in der Antwort");

  let parsed: { title?: unknown; description?: unknown };
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as typeof parsed;
  } catch {
    throw new Error("video-summary: Antwort ist kein gültiges JSON");
  }

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
  if (description.length === 0) throw new Error("video-summary: Beschreibung fehlt");

  return {
    title: title.slice(0, MAX_TITLE),
    description: description.slice(0, MAX_DESCRIPTION),
  };
}

/** Struktureller Aufbereiter (Tests injizieren einen Fake). */
export type VideoSummarizer = (input: VideoSummaryInput) => Promise<VideoSummaryResult>;

/** Aufbereiter über den geteilten Gateway-Chat (Muster: ArticleTranslator). */
export function makeVideoSummarizer(
  generate: (messages: ChatMessage[]) => Promise<string>,
): VideoSummarizer {
  return async (input) => parseVideoSummaryResponse(await generate(buildVideoSummaryMessages(input)));
}
