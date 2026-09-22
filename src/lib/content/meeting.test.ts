import { describe, expect, it } from "vitest";
import {
  meetingHref,
  parseMeetingInput,
  readMeetingConfig,
  showsAt,
  type MeetingConfig,
} from "./meeting";

/**
 * BUCHUNGSLINK (0048). Verhinderte Fehlerfälle:
 *  - Ein `javascript:`- oder http-Ziel landet an vier öffentlichen Stellen,
 *    darunter eine, an der jemand Namen und Adresse einträgt.
 *  - Eine fehlende Platzierung gilt als AN → der Link erscheint auf einer
 *    laufenden Kundeninstanz unangekündigt überall.
 *  - Kaputtes JSON in der Spalte wirft, statt still zu „kein Link" zu werden
 *    → eine unlesbare Zeile schaltet das ganze Hilfezentrum ab.
 *  - Der Kontext überschreibt ein vom Betreiber gepflegtes `notes`.
 */

const VALID = {
  url: "https://cal.com/team/intro",
  label: "Termin buchen",
  title: "Noch Fragen?",
  description: "15 Minuten, unverbindlich",
  placements: { article: true, noHelp: false, contact: true, home: false },
};

describe("parseMeetingInput", () => {
  it("nimmt eine vollständige Konfiguration an", () => {
    const res = parseMeetingInput(VALID);
    expect(res).toMatchObject({ ok: true });
    expect(res.ok && res.config.placements).toEqual({
      article: true,
      noHelp: false,
      contact: true,
      home: false,
    });
  });

  it("lehnt alles ab, was nicht https ist", () => {
    for (const url of [
      "javascript:alert(1)",
      "http://cal.com/team",
      "//cal.com/team",
      "/termin",
      "cal.com/team",
      "",
    ]) {
      expect(parseMeetingInput({ ...VALID, url }), url).toEqual({
        ok: false,
        error: "invalid_url",
      });
    }
  });

  it("verlangt Beschriftung und Überschrift", () => {
    expect(parseMeetingInput({ ...VALID, label: "  " })).toEqual({
      ok: false,
      error: "label_required",
    });
    expect(parseMeetingInput({ ...VALID, title: "" })).toEqual({
      ok: false,
      error: "title_required",
    });
  });

  it("behandelt fehlende Platzierungen als AUS", () => {
    const res = parseMeetingInput({ ...VALID, placements: { article: true } });
    expect(res.ok && res.config.placements).toEqual({
      article: true,
      noHelp: false,
      contact: false,
      home: false,
    });
  });

  it("schaltet nur bei echtem true frei — nicht bei „truthy“", () => {
    const res = parseMeetingInput({ ...VALID, placements: { article: 1, home: "ja" } });
    expect(res.ok && res.config.placements.article).toBe(false);
    expect(res.ok && res.config.placements.home).toBe(false);
  });
});

describe("readMeetingConfig", () => {
  it("macht aus Unlesbarem „kein Link“ statt eines Fehlers", () => {
    expect(readMeetingConfig("{kaputt")).toBeNull();
    expect(readMeetingConfig(null)).toBeNull();
    expect(readMeetingConfig("")).toBeNull();
    // Gültiges JSON, aber fachlich ungültig (http) — ebenfalls kein Link.
    expect(readMeetingConfig(JSON.stringify({ ...VALID, url: "http://x.de" }))).toBeNull();
  });

  it("liest eine gültige Zeile zurück", () => {
    expect(readMeetingConfig(JSON.stringify(VALID))?.url).toBe(VALID.url);
  });
});

describe("showsAt", () => {
  const config = parseMeetingInput(VALID).ok ? (parseMeetingInput(VALID) as { config: MeetingConfig }).config : null;

  it("antwortet ohne Konfiguration immer mit nein", () => {
    expect(showsAt(null, "article")).toBe(false);
    expect(showsAt(null, "contact")).toBe(false);
  });

  it("folgt den Schaltern", () => {
    expect(showsAt(config, "article")).toBe(true);
    expect(showsAt(config, "noHelp")).toBe(false);
  });
});

describe("meetingHref", () => {
  const config = (parseMeetingInput(VALID) as { config: MeetingConfig }).config;

  it("hängt den Kontext als Notiz an", () => {
    const href = meetingHref(config, "Wie binde ich die Fritzbox ein?");
    expect(new URL(href).searchParams.get("notes")).toBe("Wie binde ich die Fritzbox ein?");
  });

  it("lässt die Adresse ohne Kontext unangetastet", () => {
    expect(meetingHref(config, null)).toBe(VALID.url);
    expect(meetingHref(config, "   ")).toBe(VALID.url);
  });

  it("überschreibt ein gepflegtes notes NICHT", () => {
    const own = { ...config, url: "https://cal.com/team/intro?notes=Bitte+Vertrag+mitbringen" };
    expect(new URL(meetingHref(own, "Andere Frage")).searchParams.get("notes")).toBe(
      "Bitte Vertrag mitbringen",
    );
  });
});
