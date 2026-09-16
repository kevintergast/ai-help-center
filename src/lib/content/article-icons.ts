/**
 * SYMBOL-KATALOG für Artikel (Migration 0036).
 *
 * Bewusst ein FESTER, kleiner Satz statt freier Eingabe oder Emoji:
 *  - Alle Zeichen stammen aus demselben Icon-Satz, also gleicher Strich und
 *    gleiche Anmutung. Ein freies Emoji-Feld rendert je Betriebssystem anders
 *    und ist farbig — neben einfarbigen Symbolen wirkt das unruhig.
 *  - Der gespeicherte Wert ist der NAME, nicht die Position. Wer den Katalog
 *    umsortiert, vertauscht damit keine Symbole.
 *
 * Diese Datei kennt bewusst KEIN React: Sie wird auch auf dem Server (Prüfung
 * beim Schreiben) und im MCP-Schema gebraucht. Die Zuordnung Name → Komponente
 * liegt in `components/ui/article-icon.tsx`.
 */

export const ARTICLE_ICONS = [
  "doc",
  "sparkle",
  "info",
  "warn",
  "check",
  "key",
  "lock",
  "user",
  "userPlus",
  "settings",
  "chart",
  "code",
  "inbox",
  "card",
  "play",
  "link",
  "download",
  "bookmark",
  "megaphone",
  "roadmap",
  "grid",
  "search",
  "mic",
  "pencil",
] as const;

export type ArticleIcon = (typeof ARTICLE_ICONS)[number];

export function isArticleIcon(value: unknown): value is ArticleIcon {
  return typeof value === "string" && (ARTICLE_ICONS as readonly string[]).includes(value);
}

/**
 * Rohe Eingabe → Symbolname. `null` = keins (der Standard).
 *
 * TOLERANT beim LESEN: Ein Name, den der Katalog nicht mehr kennt, wird zu
 * `null` statt zu einem Fehler — ein entfernter Eintrag darf keinen
 * bestehenden Artikel kaputt machen. Der SCHREIBPFAD prüft dagegen streng
 * (`validate.ts`), damit Tippfehler nicht still verschwinden.
 */
export function readArticleIcon(raw: unknown): ArticleIcon | null {
  return isArticleIcon(raw) ? raw : null;
}
