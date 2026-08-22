import { describe, expect, it } from "vitest";
import { TRANSCRIPT_PROMPT_CHARS } from "./video-meta";
import {
  buildVideoSummaryMessages,
  makeVideoSummarizer,
  parseVideoSummaryResponse,
} from "./video-summary";

/**
 * Verhinderte Fehlerfälle:
 *  - Der Prompt lässt Halluzination zu ODER schickt ein Riesen-Transkript ins
 *    Modell (Kontext-Overflow → leere Antwort, Kosten ohne Ergebnis).
 *  - Eine unbrauchbare Modellantwort wird als Beschreibung übernommen und
 *    landet im KI-Index (Vertrauensbruch) statt als Fehler zu enden.
 */

describe("buildVideoSummaryMessages", () => {
  it("bindet Zielsprache + Anti-Halluzinations-Regel; kürzt das Transkript", () => {
    const [system, user] = buildVideoSummaryMessages({
      transcript: "A".repeat(TRANSCRIPT_PROMPT_CHARS + 5_000),
      videoTitle: "Kanal | Video 3",
      locale: "de",
    });
    expect(system.content).toContain("Deutsch");
    expect(system.content.toLowerCase()).toContain("erfinde nichts");
    const payload = JSON.parse(user.content) as { transcript: string; videoTitle: string };
    expect(payload.transcript.length).toBe(TRANSCRIPT_PROMPT_CHARS);
    expect(payload.videoTitle).toBe("Kanal | Video 3");
  });
});

describe("parseVideoSummaryResponse", () => {
  it("liest JSON auch mit Prosa/Codefence-Rahmen", () => {
    const raw = 'Klar!\n```json\n{"title":"Konto einrichten","description":"Zeigt die Registrierung."}\n```';
    expect(parseVideoSummaryResponse(raw)).toEqual({
      title: "Konto einrichten",
      description: "Zeigt die Registrierung.",
    });
  });

  it("wirft bei fehlender Beschreibung oder Nicht-JSON (nichts wird übernommen)", () => {
    expect(() => parseVideoSummaryResponse("Kein JSON hier")).toThrow();
    expect(() => parseVideoSummaryResponse('{"title":"Nur Titel"}')).toThrow();
    expect(() => parseVideoSummaryResponse('{"title":"T","description":"   "}')).toThrow();
  });

  it("deckelt überlange Felder (UI/DB-Grenzen)", () => {
    const res = parseVideoSummaryResponse(
      JSON.stringify({ title: "T".repeat(300), description: "D".repeat(900) }),
    );
    expect(res.title.length).toBe(120);
    expect(res.description.length).toBe(600);
  });
});

describe("makeVideoSummarizer", () => {
  it("verbindet Prompt-Bau und Antwort-Prüfung", async () => {
    const summarize = makeVideoSummarizer(async (messages) => {
      expect(messages).toHaveLength(2);
      return '{"title":"Widget einbinden","description":"Erklärt das Script-Tag."}';
    });
    expect(await summarize({ transcript: "Wir binden das Widget ein.", locale: "de" })).toEqual({
      title: "Widget einbinden",
      description: "Erklärt das Script-Tag.",
    });
  });
});
