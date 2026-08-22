import { describe, expect, it } from "vitest";
import {
  ALL_SCOPES,
  DEFAULT_SCOPES,
  includesPii,
  isBroadAccess,
  parseScopes,
  readStoredScopes,
  riskLevel,
  scopesNeedingAcknowledgement,
  tierOf,
} from "./scopes";

/**
 * Der Scope-Katalog ist die Grundlage zweier Zusagen an den Nutzer: „du siehst,
 * was der Schlüssel darf" und „gefährliches musst du bestätigen". Getestet wird
 * genau das — nicht die Katalog-Einträge selbst (die sind Daten).
 */
describe("Scope-Katalog", () => {
  it("weist unbekannte Scopes ab, statt sie still zu verwerfen", () => {
    // Fehlerfall: ein Tippfehler im Request („articles:publsh") würde sonst
    // einen Schlüssel mit WENIGER Rechten erzeugen, als der Nutzer im UI sah.
    expect(parseScopes(["articles:read", "articles:publsh"])).toBeNull();
    expect(parseScopes([])).toBeNull();
    expect(parseScopes("articles:read")).toBeNull();
    expect(parseScopes(["articles:read"])).toEqual(["articles:read"]);
  });

  it("dedupliziert und sortiert in Eskalations-Reihenfolge", () => {
    // Damit UI, Audit-Log und MCP-Anzeige dieselbe Reihenfolge zeigen.
    expect(parseScopes(["articles:delete", "articles:read", "articles:read"])).toEqual([
      "articles:read",
      "articles:delete",
    ]);
  });

  it("liest gespeicherte Scopes tolerant (entfernter Scope macht Key nicht unbrauchbar)", () => {
    // Fehlerfall: wir benennen einen Scope um → alle bestehenden Schlüssel
    // wären bei strikter Prüfung schlagartig tot.
    expect(readStoredScopes('["articles:read","legacy:whatever"]')).toEqual(["articles:read"]);
    expect(readStoredScopes("kaputt")).toEqual([]);
    expect(readStoredScopes('{"nicht":"array"}')).toEqual([]);
  });

  it("verlangt Bestätigung für JEDEN zerstörenden Scope", () => {
    // Fehlerfall: ein rotes Recht rutscht ohne bewusstes Ja durch.
    expect(scopesNeedingAcknowledgement(["articles:read", "articles:write"])).toEqual([]);
    expect(scopesNeedingAcknowledgement(["articles:delete", "support:delete"])).toEqual([
      "articles:delete",
      "support:delete",
    ]);
    for (const scope of ALL_SCOPES) {
      if (tierOf(scope) === "destructive") {
        expect(scopesNeedingAcknowledgement([scope])).toEqual([scope]);
      }
    }
  });

  it("stuft das Risiko nach der höchsten enthaltenen Stufe ein", () => {
    expect(riskLevel(["articles:read"])).toBe("low");
    expect(riskLevel(["articles:read", "articles:write"])).toBe("medium");
    expect(riskLevel(["articles:write", "articles:publish"])).toBe("high");
    expect(riskLevel(["articles:read", "articles:delete"])).toBe("critical");
  });

  it("erkennt den Generalschlüssel (veröffentlichen + löschen + Einstellungen)", () => {
    expect(isBroadAccess(["articles:publish", "articles:delete", "settings:write"])).toBe(true);
    expect(isBroadAccess(["articles:publish", "articles:delete"])).toBe(false);
  });

  it("markiert Scopes, über die personenbezogene Daten abfließen", () => {
    // Support-Tickets enthalten E-Mail-Adressen von Endkunden — die UI muss
    // dafür eigens warnen (DSGVO-Entscheidung des Verantwortlichen).
    expect(includesPii(["support:read"])).toBe(true);
    expect(includesPii(["articles:read", "analytics:read"])).toBe(false);
  });

  it("hat eine zahme Voreinstellung — nichts, was nach außen wirkt", () => {
    // Fehlerfall: ein durchgeklickter Schlüssel darf nicht ungefragt
    // veröffentlichen oder löschen können.
    for (const scope of DEFAULT_SCOPES) {
      expect(["read", "write"]).toContain(tierOf(scope));
    }
    expect(riskLevel(DEFAULT_SCOPES)).toBe("medium");
  });
});
