import { describe, expect, it } from "vitest";
import { AI_CRAWLER_AGENTS, aiCrawlerRules } from "./ai-crawlers";

/**
 * Eine verdrehte Bedingung sperrt hier entweder ALLE Instanzen aus den
 * KI-Antwortmaschinen aus oder lässt die Sperre ins Leere laufen — beides
 * fällt im Betrieb erst nach Wochen auf. Deshalb beide Richtungen explizit.
 */
describe("aiCrawlerRules", () => {
  it("erlaubt ist der Default — auch für Instanzen OHNE gesetzten Wert", () => {
    expect(aiCrawlerRules(true)).toEqual([]);
    expect(aiCrawlerRules(undefined)).toEqual([]);
  });

  it("gesperrt ⇒ je Agent ein eigener Disallow-Block", () => {
    const rules = aiCrawlerRules(false);
    expect(rules).toHaveLength(AI_CRAWLER_AGENTS.length);
    expect(rules.every((r) => r.disallow === "/")).toBe(true);
    // Die großen vier müssen drin sein, sonst ist die Sperre ein Placebo.
    const agents = rules.map((r) => r.userAgent);
    for (const must of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) {
      expect(agents).toContain(must);
    }
  });

  it("keine Dubletten (ein doppelter Block ist in robots.txt unsauber)", () => {
    expect(new Set(AI_CRAWLER_AGENTS).size).toBe(AI_CRAWLER_AGENTS.length);
  });
});
