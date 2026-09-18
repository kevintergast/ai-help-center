import { describe, expect, it } from "vitest";
import { parseComprehensionInput } from "./comprehension";

/**
 * „ICH VERSTEHE ETWAS NICHT". Verhinderte Fehlerfälle:
 *  - Der zweite Schritt (E-Mail) ist freiwillig, wird aber trotzdem erzwungen
 *    — dann bricht die Meldung genau dort ab, wo jemand anonym bleiben will.
 *  - Eine kaputte Adresse wird angenommen: Die Oberfläche verspricht eine
 *    Rückmeldung, die nie ankommt.
 *  - Ein negativer oder gebrochener Block-Index rutscht durch und zeigt später
 *    auf nichts.
 */

const base = {
  articleId: "art_1",
  anchor: 3,
  quote: "Dieser Satz ist unklar.",
  message: "Was bedeutet hier »Sondereigentum«?",
};

describe("parseComprehensionInput", () => {
  it("nimmt eine Meldung OHNE Adresse an — der zweite Schritt ist freiwillig", () => {
    expect(parseComprehensionInput(base)).toEqual({
      ok: true,
      report: { ...base, email: null },
    });
    expect(parseComprehensionInput({ ...base, email: "  " })).toMatchObject({
      ok: true,
      report: { email: null },
    });
  });

  it("nimmt eine gültige Adresse an und lehnt eine kaputte ab", () => {
    expect(parseComprehensionInput({ ...base, email: " leser@example.com " })).toMatchObject({
      ok: true,
      report: { email: "leser@example.com" },
    });
    for (const email of ["keine-adresse", "a@b", "x@y.z@q"]) {
      expect(parseComprehensionInput({ ...base, email })).toEqual({
        ok: false,
        error: "invalid_email",
      });
    }
  });

  it("verlangt Artikel, gültigen Block-Index und genug Text", () => {
    expect(parseComprehensionInput({ ...base, articleId: " " })).toEqual({
      ok: false,
      error: "article_required",
    });
    for (const anchor of [-1, 1.5, "3", undefined]) {
      expect(parseComprehensionInput({ ...base, anchor })).toEqual({
        ok: false,
        error: "invalid_anchor",
      });
    }
    expect(parseComprehensionInput({ ...base, message: "hm" })).toEqual({
      ok: false,
      error: "message_too_short",
    });
    expect(parseComprehensionInput({ ...base, message: "x".repeat(2001) })).toEqual({
      ok: false,
      error: "message_too_long",
    });
  });

  it("kürzt ein überlanges Zitat, statt die Meldung abzulehnen", () => {
    const res = parseComprehensionInput({ ...base, quote: "x".repeat(500) });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.report.quote).toHaveLength(300);
  });

  it("Index 0 ist gültig (der erste Block)", () => {
    expect(parseComprehensionInput({ ...base, anchor: 0 })).toMatchObject({ ok: true });
  });
});
