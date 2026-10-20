import { describe, expect, it } from "vitest";
import { parseArticleBody } from "./blocks";
import { articleHeadings, headingDestinations } from "./headings";

/**
 * SICHTBARE Ziele an Überschriften.
 *
 * Der teure Fehler wäre hier nicht ein fehlendes Symbol, sondern ein Symbol
 * an der FALSCHEN Überschrift: Der Leser klickt bei „Sprache einstellen" und
 * landet in der Rechnung. Deshalb muss die Zuordnung exakt dieselben
 * Anker-Ids benutzen wie der Renderer und das Inhaltsverzeichnis.
 */
const dest = (href: string, onHeading?: boolean) => ({
  type: "destination" as const,
  href,
  purpose: "Eine ausreichend lange Beschreibung des Ziels.",
  ...(onHeading ? { onHeading: true } : {}),
});
const text = (t: string) => ({ type: "text" as const, variant: "standard" as const, text: t });

describe("headingDestinations", () => {
  it("hängt das Ziel an die Überschrift DARÜBER", () => {
    const blocks = parseArticleBody([
      text("## Erster Abschnitt"),
      text("Inhalt."),
      dest("https://e.test/eins", true),
      text("## Zweiter Abschnitt"),
      text("Inhalt."),
      dest("https://e.test/zwei", true),
    ]);
    const ids = articleHeadings(blocks).map((h) => h.id);
    const map = headingDestinations(blocks);
    expect(map.get(ids[0])).toBe("https://e.test/eins");
    expect(map.get(ids[1])).toBe("https://e.test/zwei");
  });

  it("ohne Schalter bleibt das Ziel unsichtbar", () => {
    const blocks = parseArticleBody([text("## Abschnitt"), dest("https://e.test/x")]);
    expect(headingDestinations(blocks).size).toBe(0);
  });

  it("ohne Überschrift darüber gibt es nichts, woran das Symbol hängen könnte", () => {
    const blocks = parseArticleBody([text("Nur Fließtext."), dest("https://e.test/x", true)]);
    expect(headingDestinations(blocks).size).toBe(0);
  });

  it("die Anker-Ids stimmen mit denen des Inhaltsverzeichnisses überein — auch bei gleichem Titel", () => {
    // Doppelte Überschriften bekommen ein Dubletten-Suffix. Würde die
    // Zuordnung anders zählen, hinge das Symbol eine Überschrift daneben.
    const blocks = parseArticleBody([
      text("## Einstellungen"),
      dest("https://e.test/a", true),
      text("## Einstellungen"),
      dest("https://e.test/b", true),
    ]);
    const ids = articleHeadings(blocks).map((h) => h.id);
    expect(new Set(ids).size).toBe(2);
    const map = headingDestinations(blocks);
    expect(map.get(ids[0])).toBe("https://e.test/a");
    expect(map.get(ids[1])).toBe("https://e.test/b");
  });

  it("das letzte Ziel eines Abschnitts gewinnt (ein Symbol je Überschrift)", () => {
    const blocks = parseArticleBody([
      text("## Abschnitt"),
      dest("https://e.test/alt", true),
      dest("https://e.test/neu", true),
    ]);
    const id = articleHeadings(blocks)[0].id;
    expect(headingDestinations(blocks).get(id)).toBe("https://e.test/neu");
  });
});
