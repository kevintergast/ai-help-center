/**
 * MINIMALER, SICHERER Markdown-Parser für Rechtstexte (Design h: Markdown wird
 * als DATEN gespeichert und hier NIE zu Roh-HTML — die Ausgabe sind Token/
 * Block-Strukturen, die eine React-Komponente rendert; React escapet Text
 * grundsätzlich, `dangerouslySetInnerHTML` kommt nirgends vor).
 *
 * Unterstützt bewusst nur, was Rechtstexte brauchen: Überschriften (#–###),
 * Absätze, Listen (-/1.), Trennlinie, **fett**, *kursiv*, `code`,
 * [Links](https://…). Links nur mit https/http/mailto — alles andere
 * (javascript:, data:, relativ) wird als KLARTEXT gerendert (fail-closed).
 * Kein HTML-Passthrough: `<script>` & Co. sind schlicht Text.
 */

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; inline: InlineToken[] }
  | { kind: "paragraph"; inline: InlineToken[] }
  | { kind: "list"; ordered: boolean; items: InlineToken[][] }
  | { kind: "hr" };

/** Nur absolute Web-/Mail-Ziele — javascript:/data:/relativ = unsicher. */
export function isSafeHref(href: string): boolean {
  return /^https?:\/\/\S+$/i.test(href) || /^mailto:[^\s@]+@[^\s@]+$/i.test(href);
}

const INLINE_RE =
  /(`[^`]+`)|(\[[^\]\n]+\]\([^()\s]+\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: "text", text: text.slice(last, index) });
    const raw = match[0];
    if (match[1]) {
      tokens.push({ kind: "code", text: raw.slice(1, -1) });
    } else if (match[2]) {
      const inner = /^\[([^\]]+)\]\(([^()\s]+)\)$/.exec(raw);
      if (inner && isSafeHref(inner[2])) {
        tokens.push({ kind: "link", text: inner[1], href: inner[2] });
      } else {
        // Unsicheres Ziel: als Klartext belassen (KEIN Link, fail-closed).
        tokens.push({ kind: "text", text: raw });
      }
    } else if (match[3]) {
      tokens.push({ kind: "bold", text: raw.slice(2, -2) });
    } else {
      tokens.push({ kind: "italic", text: raw.slice(1, -1) });
    }
    last = index + raw.length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({
        kind: "list",
        ordered: list.ordered,
        items: list.items.map(parseInline),
      });
      list = null;
    }
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        inline: parseInline(heading[2]),
      });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "hr" });
      continue;
    }

    const unordered = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = !!ordered;
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((unordered ?? ordered)![1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}
