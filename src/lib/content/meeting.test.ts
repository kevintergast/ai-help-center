import { describe, expect, it } from "vitest";
import {
  meetingHref,
  meetingLinkById,
  parseMeetingInput,
  placementLink,
  readMeetingConfig,
  showsAt,
  type MeetingConfig,
} from "./meeting";

/**
 * BUCHUNGSLINKS (0048). Verhinderte Fehlerfälle:
 *  - Ein `javascript:`- oder http-Ziel landet an öffentlichen Stellen, darunter
 *    eine, an der jemand Namen und Adresse einträgt.
 *  - Zwei Kalender teilen sich eine Kennung → ein Support-Baustein trifft je
 *    nach Reihenfolge einen anderen Termin.
 *  - Ein Baustein zeigt auf einen gelöschten Kalender und steht dann leer da,
 *    statt wenigstens den allgemeinen Termin anzubieten.
 *  - Eine fehlende Platzierung gilt als AN → der Link erscheint auf einer
 *    laufenden Kundeninstanz unangekündigt überall.
 *  - Kaputtes JSON wirft, statt still zu „kein Termin" zu werden — eine
 *    unlesbare Zeile schaltet sonst das ganze Hilfezentrum ab.
 *  - Der mitgereiste Kontext überschreibt ein vom Betreiber gepflegtes `notes`.
 */

const ALLGEMEIN = {
  id: "beratung",
  title: "Noch Fragen?",
  label: "Termin buchen",
  description: "15 Minuten, unverbindlich",
  url: "https://cal.com/team/intro",
};
const SPEZIELL = {
  id: "telefonanlage",
  title: "Telefonanlage einrichten",
  label: "Einrichtung buchen",
  description: "",
  url: "https://cal.com/team/telefonie",
};
const VALID = {
  links: [ALLGEMEIN, SPEZIELL],
  placements: { article: true, noHelp: false, contact: true, home: false },
  placementLinkId: "beratung",
};

const parsed = (raw: unknown): MeetingConfig => {
  const res = parseMeetingInput(raw);
  if (!res.ok) throw new Error(`unerwartet ungültig: ${res.error}`);
  return res.config;
};

describe("parseMeetingInput", () => {
  it("nimmt mehrere Kalender an", () => {
    const config = parsed(VALID);
    expect(config.links.map((l) => l.id)).toEqual(["beratung", "telefonanlage"]);
    expect(config.placementLinkId).toBe("beratung");
  });

  it("verlangt mindestens einen Kalender", () => {
    expect(parseMeetingInput({ links: [] })).toEqual({ ok: false, error: "links_required" });
    expect(parseMeetingInput({})).toEqual({ ok: false, error: "links_required" });
  });

  it("lehnt doppelte Kennungen ab (sonst ist ein Baustein mehrdeutig)", () => {
    expect(parseMeetingInput({ ...VALID, links: [ALLGEMEIN, { ...SPEZIELL, id: "beratung" }] })).toEqual(
      { ok: false, error: "duplicate_id" },
    );
  });

  it("verlangt sprechende Kennungen", () => {
    for (const id of ["", "Telefon Anlage", "-start", "ümlaut", "unter_strich"]) {
      expect(parseMeetingInput({ ...VALID, links: [{ ...ALLGEMEIN, id }] }), id).toEqual({
        ok: false,
        error: "invalid_id",
      });
    }
  });

  it("schreibt Großschreibung klein, statt sie abzulehnen", () => {
    // Nachsichtig an genau der Stelle, an der ein Mensch tippt — und der
    // Baustein sucht ohnehin kleingeschrieben.
    expect(parsed({ ...VALID, links: [{ ...ALLGEMEIN, id: "Telefonanlage" }] }).links[0].id).toBe(
      "telefonanlage",
    );
  });

  it("lehnt alles ab, was nicht https ist", () => {
    for (const url of ["javascript:alert(1)", "http://cal.com/team", "//cal.com", "/termin", ""]) {
      expect(parseMeetingInput({ ...VALID, links: [{ ...ALLGEMEIN, url }] }), url).toEqual({
        ok: false,
        error: "invalid_url",
      });
    }
  });

  it("behandelt fehlende Platzierungen als AUS", () => {
    expect(parsed({ ...VALID, placements: { article: true } }).placements).toEqual({
      article: true,
      noHelp: false,
      contact: false,
      home: false,
    });
  });

  it("schaltet nur bei echtem true frei — nicht bei „truthy“", () => {
    const config = parsed({ ...VALID, placements: { article: 1, home: "ja" } });
    expect(config.placements.article).toBe(false);
    expect(config.placements.home).toBe(false);
  });

  it("fällt auf den ersten Kalender zurück, wenn die Platzierungs-Kennung ins Leere zeigt", () => {
    // Sonst verschwänden die automatischen Stellen stumm, sobald jemand den
    // gewählten Kalender löscht.
    expect(parsed({ ...VALID, placementLinkId: "geloescht" }).placementLinkId).toBe("beratung");
  });
});

describe("readMeetingConfig", () => {
  it("macht aus Unlesbarem „kein Termin“ statt eines Fehlers", () => {
    expect(readMeetingConfig("{kaputt")).toBeNull();
    expect(readMeetingConfig(null)).toBeNull();
    expect(readMeetingConfig("")).toBeNull();
    // Gültiges JSON, fachlich ungültig (http) → ebenfalls kein Termin.
    expect(
      readMeetingConfig(JSON.stringify({ ...VALID, links: [{ ...ALLGEMEIN, url: "http://x.de" }] })),
    ).toBeNull();
  });

  it("liest eine gültige Zeile zurück", () => {
    expect(readMeetingConfig(JSON.stringify(VALID))?.links).toHaveLength(2);
  });
});

describe("Auswahl des richtigen Kalenders", () => {
  const config = parsed(VALID);

  it("placementLink liefert den für die automatischen Stellen", () => {
    expect(placementLink(config)?.id).toBe("beratung");
    expect(placementLink(null)).toBeNull();
  });

  it("meetingLinkById trifft den speziellen Kalender", () => {
    expect(meetingLinkById(config, "telefonanlage")?.id).toBe("telefonanlage");
  });

  it("fällt bei unbekannter Kennung auf den allgemeinen zurück, statt nichts anzubieten", () => {
    expect(meetingLinkById(config, "gibts-nicht")?.id).toBe("beratung");
    expect(meetingLinkById(config, null)?.id).toBe("beratung");
  });

  it("ohne Konfiguration gibt es nichts", () => {
    expect(meetingLinkById(null, "beratung")).toBeNull();
  });
});

describe("showsAt", () => {
  const config = parsed(VALID);

  it("folgt den Schaltern", () => {
    expect(showsAt(config, "article")).toBe(true);
    expect(showsAt(config, "noHelp")).toBe(false);
  });

  it("antwortet ohne Konfiguration immer mit nein", () => {
    expect(showsAt(null, "article")).toBe(false);
  });
});

describe("meetingHref", () => {
  it("hängt den Kontext als Notiz an", () => {
    const href = meetingHref(ALLGEMEIN, "Wie binde ich die Fritzbox ein?");
    expect(new URL(href).searchParams.get("notes")).toBe("Wie binde ich die Fritzbox ein?");
  });

  it("lässt die Adresse ohne Kontext unangetastet", () => {
    expect(meetingHref(ALLGEMEIN, null)).toBe(ALLGEMEIN.url);
    expect(meetingHref(ALLGEMEIN, "   ")).toBe(ALLGEMEIN.url);
  });

  it("überschreibt ein gepflegtes notes NICHT", () => {
    const own = { ...ALLGEMEIN, url: "https://cal.com/team/intro?notes=Vertrag+mitbringen" };
    expect(new URL(meetingHref(own, "Andere Frage")).searchParams.get("notes")).toBe(
      "Vertrag mitbringen",
    );
  });
});
