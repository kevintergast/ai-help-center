import { parseBlocks, type InlineNode } from "./rich-text";
import { uniqueAnchorId } from "./heading-anchor";
import type { ArticleBlock } from "./blocks";

/**
 * ÜBERSCHRIFTEN eines Artikels — die EINE Quelle für Inhaltsverzeichnis und
 * Anker-Ids.
 *
 * Warum hier und nicht in der Komponente: Das Inhaltsverzeichnis verlinkt auf
 * `#id`, der Renderer setzt `id` auf die Überschrift. Würden beide Seiten die
 * Ids getrennt herleiten, genügt eine kleine Abweichung (Absatz-Splittung,
 * Reihenfolge, Dubletten-Suffix) und die Sprungmarken zeigen ins Leere. Beide
 * benutzen darum dieselben Funktionen aus dieser Datei.
 */

export interface ArticleHeading {
  level: 2 | 3;
  text: string;
  id: string;
}

/** Ein Text-Block kann mehrere Markdown-Absätze enthalten (\n\n-getrennt). */
export function textToParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Reiner Text einer Inline-Kette (Basis der Anker-Id). */
export function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => (n.kind === "text" || n.kind === "code" ? n.text : inlineText(n.children)))
    .join("");
}

/**
 * Alle h2/h3 des Artikels in DOKUMENTREIHENFOLGE mit ihren Anker-Ids.
 * Deckt genau die Blöcke ab, die der Renderer durch `RichTextView` schickt
 * (Text-Blöcke außer `code` — auch Info-/Warn-/Fehler-Boxen). Accordion-Titel
 * gehören bewusst NICHT dazu: ein Sprung auf eingeklappten Inhalt hilft nicht.
 */
export function articleHeadings(blocks: ArticleBlock[]): ArticleHeading[] {
  const taken = new Set<string>();
  const out: ArticleHeading[] = [];
  for (const block of blocks) {
    if (block.type !== "text" || block.variant === "code") continue;
    for (const parsed of parseBlocks(textToParagraphs(block.text))) {
      if (parsed.kind !== "h2" && parsed.kind !== "h3") continue;
      const text = inlineText(parsed.inline);
      out.push({ level: parsed.kind === "h2" ? 2 : 3, text, id: uniqueAnchorId(text, taken) });
    }
  }
  return out;
}
