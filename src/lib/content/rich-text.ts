/**
 * RICH-TEXT-SUBSET der Artikel-Blöcke (Content-Werkzeuge R3, Tiptap).
 *
 * GRUNDSATZ (unverändert seit dem Content-Backend): Der Artikel-Body bleibt
 * DATEN — `string[]`-Blöcke, nie HTML. Dieses Modul definiert das erlaubte
 * Markdown-Subset dieser Blöcke und parst es in eine strukturierte Form, die
 * der React-Renderer (rich-text-view.tsx) und der Tiptap-Editor gemeinsam
 * nutzen. Es gibt bewusst KEINEN HTML-Pfad: Der Parser erzeugt ausschließlich
 * Text-Knoten + whitelisted Link-URLs (nur http/https) — XSS ist strukturell
 * ausgeschlossen, egal was importiert oder gespeichert wird.
 *
 * BLOCK-Syntax (ein Block = ein Array-Eintrag; Listen sind MEHRZEILIG):
 *   "## Überschrift"        → h2          "### Unterüberschrift" → h3
 *   "- Punkt\n- Punkt"      → ul          "1. Punkt\n2. Punkt"   → ol
 *   "> Zitat"               → quote       "```\ncode\n```"       → code
 *   alles andere            → Absatz
 * INLINE (in Absätzen/Listen/Zitaten/Überschriften):
 *   **fett**  *kursiv*  `code`  [Text](https://…)
 *
 * ALT-BESTAND: reine Text-Absätze sind ein gültiges Subset → identische
 * Chunk-Hashes, nichts wird „veraltet". Der KI-Kontext (toIndexable) nutzt
 * weiterhin die ROHEN Block-Strings (Marker stören Embeddings nicht messbar).
 */

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: InlineNode[] }
  | { kind: "italic"; children: InlineNode[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: InlineNode[] };

export type RichBlock =
  | { kind: "p"; inline: InlineNode[] }
  | { kind: "h2"; inline: InlineNode[] }
  | { kind: "h3"; inline: InlineNode[] }
  | { kind: "ul"; items: InlineNode[][] }
  | { kind: "ol"; items: InlineNode[][] }
  | { kind: "quote"; inline: InlineNode[] }
  | { kind: "code"; text: string };

/** Nur http(s)-Links sind erlaubt — alles andere wird zu reinem Text. */
export function isSafeHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

/**
 * Index der zur Markdown-Link-Klammer gehörenden `)` ab `start`, mit
 * Klammer-Bilanz — so überlebt `https://…/Foo_(bar)` als ein Link. -1, wenn
 * keine schließende Klammer die Bilanz ausgleicht.
 */
function matchCloseParen(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * Inline-Markdown → Knoten. Konservativ: nicht Schließbares bleibt LITERAL
 * (ein einzelnes `**` wird Text, nie kaputte Struktur). Kein Nesting von
 * Links in Links; unsichere Hrefs degradieren zum reinen Link-Text.
 */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer.length > 0) {
      nodes.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);

    // `code` — Inhalt bleibt roh (keine weiteren Marks im Code).
    if (rest.startsWith("`")) {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        flush();
        nodes.push({ kind: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // **fett** vor *kursiv* prüfen (Präfix-Kollision).
    if (rest.startsWith("**")) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 1) {
        flush();
        nodes.push({ kind: "bold", children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (rest.startsWith("*")) {
      const end = text.indexOf("*", i + 1);
      // end > i + 1: mind. ein Zeichen dazwischen → `**` erzeugt kein Leer-Italic.
      if (end > i + 1) {
        flush();
        nodes.push({ kind: "italic", children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    // [Text](url) — schließende Klammer BALANCED suchen, damit URLs mit
    // Klammern (z. B. Wikipedia `..._(foo)`) nicht vorzeitig abbrechen.
    if (rest.startsWith("[")) {
      const close = text.indexOf("](", i + 1);
      const end = close > i ? matchCloseParen(text, close + 2) : -1;
      if (close > i && end > close) {
        const label = text.slice(i + 1, close);
        const href = text.slice(close + 2, end);
        flush();
        if (isSafeHref(href)) {
          nodes.push({ kind: "link", href: href.trim(), children: parseInline(label) });
        } else {
          // Unsicheres Ziel (javascript:, data:, relativ …) → nur der Text.
          nodes.push(...parseInline(label));
        }
        i = end + 1;
        continue;
      }
    }

    buffer += text[i];
    i += 1;
  }
  flush();
  return nodes;
}

/** Einen Block-String in seine strukturierte Form parsen. */
export function parseBlock(block: string): RichBlock {
  const trimmed = block.replace(/\r\n/g, "\n");

  const codeMatch = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(trimmed);
  if (codeMatch) return { kind: "code", text: codeMatch[1] };

  const h2 = /^##\s+(.+)$/s.exec(trimmed);
  if (h2 && !h2[1].startsWith("#")) return { kind: "h2", inline: parseInline(h2[1].trim()) };
  const h3 = /^###\s+(.+)$/s.exec(trimmed);
  if (h3) return { kind: "h3", inline: parseInline(h3[1].trim()) };

  const lines = trimmed.split("\n").map((l) => l.trim());
  if (lines.length > 0 && lines.every((l) => /^[-*]\s+/.test(l))) {
    return { kind: "ul", items: lines.map((l) => parseInline(l.replace(/^[-*]\s+/, ""))) };
  }
  if (lines.length > 0 && lines.every((l) => /^\d+[.)]\s+/.test(l))) {
    return { kind: "ol", items: lines.map((l) => parseInline(l.replace(/^\d+[.)]\s+/, ""))) };
  }
  if (lines.every((l) => l.startsWith(">"))) {
    const inner = lines.map((l) => l.replace(/^>\s?/, "")).join(" ");
    if (inner.trim().length > 0) return { kind: "quote", inline: parseInline(inner.trim()) };
  }

  // Absatz: interne Zeilenumbrüche werden zu Leerzeichen (wie bisher gerendert).
  return { kind: "p", inline: parseInline(lines.join(" ").trim()) };
}

export function parseBlocks(body: string[]): RichBlock[] {
  return body.filter((b) => b.trim().length > 0).map(parseBlock);
}

/* ————— Rückrichtung: strukturierte Form → Block-Strings (Tiptap-Save) ————— */

export function inlineToString(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
          return n.text;
        case "bold":
          return `**${inlineToString(n.children)}**`;
        case "italic":
          return `*${inlineToString(n.children)}*`;
        case "code":
          return `\`${n.text}\``;
        case "link":
          return `[${inlineToString(n.children)}](${n.href})`;
      }
    })
    .join("");
}

export function blockToString(block: RichBlock): string {
  switch (block.kind) {
    case "p":
      return inlineToString(block.inline);
    case "h2":
      return `## ${inlineToString(block.inline)}`;
    case "h3":
      return `### ${inlineToString(block.inline)}`;
    case "ul":
      return block.items.map((it) => `- ${inlineToString(it)}`).join("\n");
    case "ol":
      return block.items.map((it, i) => `${i + 1}. ${inlineToString(it)}`).join("\n");
    case "quote":
      return `> ${inlineToString(block.inline)}`;
    case "code":
      return `\`\`\`\n${block.text}\n\`\`\``;
  }
}
