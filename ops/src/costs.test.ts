import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "@product/server/billing/pricing";
import {
  computeDealCosts,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PRICES,
  type DealVolumes,
} from "./costs";

/**
 * SELBSTKOSTENRECHNER. Verhinderte Fehlerfälle:
 *  - Formel-Regression: eine falsch skalierte Einheit (M Tokens vs. Tokens,
 *    100M vs. 1M Dims) macht jede Deal-Kalkulation um Größenordnungen falsch.
 *  - Credit-Drift: der Rechner rechnet mit ANDEREN Credits als das Produkt →
 *    empfohlener Deckel passt nicht zum echten Verbrauch.
 *  - Division durch 0 / NaN bei leeren Volumina.
 */

const VOLUMES: DealVolumes = {
  kiAntworten: 1_000,
  kiOhneAntwort: 0,
  uebersetzungen: 10,
  views: 100_000,
  mau: 5_000,
  artikel: 50,
};

describe("computeDealCosts", () => {
  it("rechnet ein handgerechnetes Beispiel exakt (Listenpreise, Standard-Annahmen)", () => {
    const r = computeDealCosts(VOLUMES, DEFAULT_ASSUMPTIONS, DEFAULT_PRICES);

    // Handrechnung (Formeln s. costs.ts):
    // LLM: in = 1000×3000 + 10×3000 = 3,03M ×0.293$ ; out = 1000×500 + 10×3000 = 0,53M ×2.253$
    const llm = 3.03 * 0.293 + 0.53 * 2.253;
    // Embeddings: 1000×50 + 50×3×400×1 = 110k Tokens ×0.012$/M
    const embed = 0.11 * 0.012;
    // Vectorize: (1000 Fragen + 150 Upserts)×1024 Dims ×0.01$/M + 150×1024 ×0.05$/100M
    const vectorize = ((1_150 * 1_024) / 1e6) * 0.01 + ((153_600) / 1e8) * 0.05;
    // D1: reads 100000×5+1000×15=515k ×0.001$/M ; writes 100000×2+1000×4=204k ×1$/M
    const d1 = 0.515 * 0.001 + 0.204 * 1.0;

    expect(r.variabelUsd).toBeCloseTo(llm + embed + vectorize + d1, 6);
    expect(r.fixUsd).toBe(5);
    expect(r.gesamtUsd).toBeCloseTo(llm + embed + vectorize + d1 + 5, 6);
    expect(r.gesamtEur).toBeCloseTo(r.gesamtUsd * 0.92, 6);
    // Die LLM-Zeile dominiert (Realitäts-Check der Größenordnungen).
    expect(r.lines[0].usd).toBeGreaterThan(r.lines[1].usd + r.lines[2].usd + r.lines[3].usd);
  });

  it("Credits kommen aus der PRODUKT-Preisregel (kein Drift zum Enforcement)", () => {
    const r = computeDealCosts(VOLUMES, DEFAULT_ASSUMPTIONS, DEFAULT_PRICES);
    expect(r.credits).toBe(
      100_000 * CREDIT_COSTS.article_view +
        1_000 * CREDIT_COSTS.ai_generation +
        10 * CREDIT_COSTS.ai_translation,
    );
    // Deckel-Empfehlung: +20 % Puffer, auf volle 1.000 aufgerundet.
    expect(r.creditsDeckelEmpfehlung).toBe(Math.ceil((r.credits * 1.2) / 1_000) * 1_000);
    expect(r.mauDeckelEmpfehlung).toBe(6_000);
  });

  it("nicht-geerdete Fragen kosten Geld (Embedding+Vectorize), aber KEINE Credits", () => {
    const ohne = computeDealCosts(
      { ...VOLUMES, kiAntworten: 0, uebersetzungen: 0, views: 0, kiOhneAntwort: 1_000 },
      DEFAULT_ASSUMPTIONS,
      DEFAULT_PRICES,
    );
    expect(ohne.credits).toBe(0);
    expect(ohne.variabelUsd).toBeGreaterThan(0);
    expect(ohne.je1kCreditsEur).toBeNull(); // keine Division durch 0
  });

  it("leere Volumina → nur Fixkosten, keine NaN", () => {
    const r = computeDealCosts(
      { kiAntworten: 0, kiOhneAntwort: 0, uebersetzungen: 0, views: 0, mau: 0, artikel: 0 },
      DEFAULT_ASSUMPTIONS,
      DEFAULT_PRICES,
    );
    expect(r.variabelUsd).toBe(0);
    expect(r.gesamtUsd).toBe(5);
    expect(Number.isFinite(r.gesamtEur)).toBe(true);
    expect(r.jeAntwortUsd).toBeGreaterThan(0); // Grenzkosten sind volumenunabhängig
  });
});
