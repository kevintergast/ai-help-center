import { describe, expect, it } from "vitest";
import { headingAnchorId, uniqueAnchorId } from "./heading-anchor";

/**
 * Verhinderte Fehlerfälle: geteilte Abschnitts-Links brechen, weil die Id
 * (a) aus der Position statt dem Text kommt, (b) bei doppelten Überschriften
 * kollidiert oder (c) bei nicht-lateinischen Titeln leer ist (Anker ins Nichts).
 */
describe("headingAnchorId", () => {
  it("normalisiert Umlaute, Satzzeichen und Länge", () => {
    expect(headingAnchorId("Konto einrichten")).toBe("konto-einrichten");
    expect(headingAnchorId("Größe & Maße (wichtig!)")).toBe("groesse-masse-wichtig");
    expect(headingAnchorId("  ## Schon getrimmt?  ")).toBe("schon-getrimmt");
    expect(headingAnchorId("x".repeat(80)).length).toBe(60);
  });

  it("nicht-lateinische Überschrift → brauchbarer Fallback", () => {
    expect(headingAnchorId("日本語")).toBe("abschnitt");
  });
});

describe("uniqueAnchorId", () => {
  it("vergibt bei Dubletten -2/-3, stabil in Dokumentreihenfolge", () => {
    const taken = new Set<string>();
    expect(uniqueAnchorId("Schritte", taken)).toBe("schritte");
    expect(uniqueAnchorId("Schritte", taken)).toBe("schritte-2");
    expect(uniqueAnchorId("Schritte", taken)).toBe("schritte-3");
    expect(uniqueAnchorId("Anderes", taken)).toBe("anderes");
  });
});
