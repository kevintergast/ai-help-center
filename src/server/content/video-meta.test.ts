import { describe, expect, it } from "vitest";
import {
  fetchVideoTitle,
  normalizePastedTranscript,
  parseTimedTextXml,
  tryFetchTranscript,
} from "./video-meta";

/**
 * Verhinderte Fehlerfälle:
 *  - Transkript-Text landet mit Zeitmarken/Entities/XML-Resten im Prompt und
 *    später (via Beschreibung) im KI-Index — schlechte Treffer, hässliche UI.
 *  - Der Best-Effort-Abruf WIRFT bei Blockade (403/Bot-Seite) statt `null` zu
 *    liefern → der Editor-Button würde mit 500 abbrechen statt aufs
 *    Einfügen-Feld umzuschalten (realer YouTube-Zustand, verifiziert).
 *  - Fremde Hosts in YouTubes captionTracks würden blind gefetcht (SSRF).
 */

describe("parseTimedTextXml", () => {
  it("fügt Segmente zu Fließtext; dekodiert doppelt escapte Entities", () => {
    const xml = `<?xml version="1.0"?><transcript>
      <text start="0" dur="2">Hallo und   willkommen</text>
      <text start="2" dur="3">wir zeigen dir&amp;#39;s heute</text>
      <text start="5" dur="1"></text>
      <text start="6" dur="2">Schritt f&amp;#252;r Schritt <b>hier</b></text>
    </transcript>`;
    expect(parseTimedTextXml(xml)).toBe(
      "Hallo und willkommen wir zeigen dir's heute Schritt für Schritt hier",
    );
  });

  it("XML ohne Segmente → leerer String (Aufrufer fällt auf manuell zurück)", () => {
    expect(parseTimedTextXml("<transcript></transcript>")).toBe("");
  });
});

describe("normalizePastedTranscript", () => {
  it("entfernt Zeitmarken-Zeilen UND führende Zeitmarken, glättet zu Fließtext", () => {
    const pasted = [
      "0:00",
      "Willkommen zum Einrichtungs-Video",
      "0:14 Zuerst öffnest du die Einstellungen",
      "",
      "1:02:33",
      "Am Ende speicherst du alles",
      "[2:10] Fertig",
    ].join("\n");
    expect(normalizePastedTranscript(pasted)).toBe(
      "Willkommen zum Einrichtungs-Video Zuerst öffnest du die Einstellungen Am Ende speicherst du alles Fertig",
    );
  });

  it("leere Eingabe → leerer String (kein Credit-Verbrauch beim Aufrufer)", () => {
    expect(normalizePastedTranscript("\n  \n0:05\n")).toBe("");
  });
});

describe("fetchVideoTitle (oEmbed)", () => {
  it("liefert den Titel; ungültige Id fetcht NICHT; Fehler → null", async () => {
    const calls: string[] = [];
    const ok = async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ title: "  Konto einrichten  " }), { status: 200 });
    };
    expect(await fetchVideoTitle("dQw4w9WgXcQ", ok)).toBe("Konto einrichten");
    expect(calls[0]).toContain("youtube.com/oembed");
    expect(calls[0]).toContain("dQw4w9WgXcQ");

    // Keine echte Video-Id → kein Netzzugriff (SSRF-/Unsinn-Schutz).
    const spy: string[] = [];
    await fetchVideoTitle("../evil", async (u) => {
      spy.push(u);
      return new Response("{}");
    });
    expect(spy).toEqual([]);

    expect(await fetchVideoTitle("dQw4w9WgXcQ", async () => new Response("", { status: 429 }))).toBeNull();
  });
});

describe("tryFetchTranscript (Best Effort)", () => {
  it("YouTube blockt (403) → null, KEIN Throw (der Editor schaltet auf manuell)", async () => {
    expect(
      await tryFetchTranscript("dQw4w9WgXcQ", async () => new Response("blocked", { status: 403 })),
    ).toBeNull();
  });

  it("Bot-Seite ohne captionTracks → null; Netzfehler → null", async () => {
    expect(
      await tryFetchTranscript("dQw4w9WgXcQ", async () => new Response("<html>consent</html>")),
    ).toBeNull();
    expect(
      await tryFetchTranscript("dQw4w9WgXcQ", async () => {
        throw new Error("network");
      }),
    ).toBeNull();
  });

  it("Erfolgspfad: deutsche Spur bevorzugt, XML → Fließtext", async () => {
    const html = `x"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=en","languageCode":"en"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&amp;lang=de","languageCode":"de"}]y`;
    const urls: string[] = [];
    const text = await tryFetchTranscript("dQw4w9WgXcQ", async (url) => {
      urls.push(url);
      if (url.includes("/watch")) return new Response(html);
      return new Response(`<transcript><text start="0">Erster Satz</text></transcript>`);
    });
    expect(text).toBe("Erster Satz");
    expect(urls[1]).toContain("lang=de"); // deutsche Spur gewählt
  });

  it("SSRF-Schutz: captionTracks mit FREMDEM Host wird nicht gefetcht", async () => {
    const html = `"captionTracks":[{"baseUrl":"https://evil.example/steal","languageCode":"de"}]`;
    const urls: string[] = [];
    const text = await tryFetchTranscript("dQw4w9WgXcQ", async (url) => {
      urls.push(url);
      return new Response(html);
    });
    expect(text).toBeNull();
    expect(urls.some((u) => u.includes("evil.example"))).toBe(false);
  });
});
