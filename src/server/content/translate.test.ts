import { describe, expect, it } from "vitest";
import { buildTranslationMessages, translateArticle, TranslationFormatError } from "./translate";

/**
 * KI-Übersetzung (bezahltes Feature). Verhinderte Fehlerfälle:
 *  - Kaputte/verkürzte Modell-Antworten werden TEILWEISE übernommen → Artikel
 *    mit fehlenden Blöcken, aber Credits verbucht (Route verbucht nur Erfolg —
 *    dieser Vertrag hängt daran, dass hier hart geworfen wird).
 *  - Code-Blöcke werden „mitübersetzt" und dadurch zerstört.
 */

const INPUT = {
  sourceLocale: "de",
  targetLocale: "en",
  title: "Team einladen",
  body: ["Absatz eins.", "```\nconst x = 1;\n```"],
  imageDescriptions: ["Screenshot des Dialogs"],
};

describe("translateArticle", () => {
  it("übernimmt eine strukturkonforme Antwort (Code-Block bleibt WÖRTLICH)", async () => {
    const generate = async () =>
      `Hier die Übersetzung:\n${JSON.stringify({
        title: "Invite your team",
        body: ["Paragraph one.", "```\nKAPUTT übersetzt\n```"],
        imageDescriptions: ["Screenshot of the dialog"],
      })}`;
    const result = await translateArticle(generate, INPUT);
    expect(result.title).toBe("Invite your team");
    expect(result.body[0]).toBe("Paragraph one.");
    // Fail-closed: Code-Block kommt aus dem ORIGINAL, nie aus dem Modell.
    expect(result.body[1]).toBe("```\nconst x = 1;\n```");
    expect(result.imageDescriptions).toEqual(["Screenshot of the dialog"]);
  });

  const badResponses: [string, () => Promise<string>][] = [
    ["kein JSON", async () => "Sorry, das kann ich nicht."],
    ["Block-Anzahl weicht ab", async () => JSON.stringify({ title: "x", body: ["nur einer"], imageDescriptions: ["d"] })],
    ["leerer Titel", async () => JSON.stringify({ title: " ", body: ["a", "b"], imageDescriptions: ["d"] })],
    ["Beschreibungs-Anzahl weicht ab", async () => JSON.stringify({ title: "x", body: ["a", "b"], imageDescriptions: [] })],
  ];
  it.each(badResponses)("wirft bei: %s (KEINE Teil-Übernahme)", async (_label, generate) => {
    await expect(translateArticle(generate, INPUT)).rejects.toBeInstanceOf(TranslationFormatError);
  });

  it("Prompt trägt Quell-/Zielsprache und die Format-Regeln", () => {
    const [system, user] = buildTranslationMessages(INPUT);
    expect(system.content).toContain("Deutsch");
    expect(system.content).toContain("English");
    expect(system.content).toContain("URL exakt beibehalten");
    expect(user.content).toContain("Team einladen");
  });
});
