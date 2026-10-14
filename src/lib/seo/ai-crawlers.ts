/**
 * KI-CRAWLER-REGELN für robots.txt (Migration 0051).
 *
 * Als eigene, reine Funktion statt inline in der Route: Eine falsche
 * robots.txt nimmt einem Kunden die Auffindbarkeit, und zwar still — man
 * merkt es erst Wochen später am Traffic. Diese Regel gehört deshalb an eine
 * Stelle, die man prüfen kann, ohne eine Next-Route zu starten.
 */

/**
 * Agenten, die KI-Antwortmaschinen und Trainingsdaten bedienen.
 *
 * Bewusst EXPLIZIT und nicht über `*`: Ein spezifischer User-agent-Block
 * sticht in robots.txt den Stern. Wer `*` erlaubt (das wollen wir, normale
 * Suchmaschinen sollen crawlen) und zusätzlich KI ausschließen will, braucht
 * je Agent einen eigenen Block — sonst greift die Sperre nicht.
 *
 * Die Liste ist eine Momentaufnahme und altert. Ein Agent, der hier fehlt,
 * wird von `*` erlaubt — im Zweifel also eher zu viel Zugriff als zu wenig.
 * Das ist die richtige Richtung für einen Default, der „erlaubt" heißt, aber
 * der Grund, sie gelegentlich nachzuziehen.
 */
export const AI_CRAWLER_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
  "Applebot-Extended",
  "meta-externalagent",
] as const;

/**
 * `allowed === false` ⇒ je Agent ein Disallow-Block. Alles andere (auch
 * `undefined`, der Zustand bestehender Instanzen) ⇒ keine Sonderregel, der
 * normale `*`-Block erlaubt sie weiterhin.
 */
export function aiCrawlerRules(
  allowed: boolean | undefined,
): { userAgent: string; disallow: string }[] {
  if (allowed !== false) return [];
  return AI_CRAWLER_AGENTS.map((userAgent) => ({ userAgent, disallow: "/" }));
}
