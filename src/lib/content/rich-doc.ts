import {
  blockToString,
  isSafeHref,
  parseBlocks,
  type InlineNode,
  type RichBlock,
} from "./rich-text";

/**
 * BRÜCKE Artikel-Blöcke ↔ Tiptap-/ProseMirror-Dokument (JSON) — PURE Daten-
 * Konvertierung ohne @tiptap-Import (unit-testbar; der Editor konsumiert sie).
 *
 * Roundtrip-Garantie fürs Subset: blocks → doc → blocks ist verlustfrei;
 * Dokument-Features AUSSERHALB des Subsets (verschachtelte Listen, unbekannte
 * Marks) degradieren beim Speichern zu ihrem Text — nie zu kaputter Struktur.
 * Links werden in BEIDEN Richtungen auf http(s) geprüft (isSafeHref).
 */

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/* ————— Blöcke → Dokument (Editor laden) ————— */

function inlineToDocNodes(nodes: InlineNode[], marks: DocNode["marks"] = []): DocNode[] {
  const out: DocNode[] = [];
  for (const n of nodes) {
    switch (n.kind) {
      case "text":
        if (n.text.length > 0) out.push({ type: "text", text: n.text, marks: marks.length ? marks : undefined });
        break;
      case "bold":
        out.push(...inlineToDocNodes(n.children, [...marks, { type: "bold" }]));
        break;
      case "italic":
        out.push(...inlineToDocNodes(n.children, [...marks, { type: "italic" }]));
        break;
      case "code":
        out.push({ type: "text", text: n.text, marks: [...marks, { type: "code" }] });
        break;
      case "link":
        out.push(
          ...inlineToDocNodes(n.children, [...marks, { type: "link", attrs: { href: n.href } }]),
        );
        break;
    }
  }
  return out;
}

function listItem(inline: InlineNode[]): DocNode {
  return { type: "listItem", content: [{ type: "paragraph", content: inlineToDocNodes(inline) }] };
}

function blockToDocNode(block: RichBlock): DocNode {
  switch (block.kind) {
    case "h2":
      return { type: "heading", attrs: { level: 2 }, content: inlineToDocNodes(block.inline) };
    case "h3":
      return { type: "heading", attrs: { level: 3 }, content: inlineToDocNodes(block.inline) };
    case "ul":
      return { type: "bulletList", content: block.items.map(listItem) };
    case "ol":
      return { type: "orderedList", content: block.items.map(listItem) };
    case "quote":
      return {
        type: "blockquote",
        content: [{ type: "paragraph", content: inlineToDocNodes(block.inline) }],
      };
    case "code":
      return { type: "codeBlock", content: block.text ? [{ type: "text", text: block.text }] : [] };
    default:
      return { type: "paragraph", content: inlineToDocNodes(block.inline) };
  }
}

export function blocksToDoc(body: string[]): DocNode {
  const blocks = parseBlocks(body);
  return {
    type: "doc",
    content: blocks.length > 0 ? blocks.map(blockToDocNode) : [{ type: "paragraph" }],
  };
}

/* ————— Dokument → Blöcke (Editor speichern) ————— */

function docInline(nodes: DocNode[] | undefined): InlineNode[] {
  const out: InlineNode[] = [];
  for (const n of nodes ?? []) {
    if (n.type !== "text" || typeof n.text !== "string") continue;
    let node: InlineNode = { kind: "text", text: n.text };
    const marks = n.marks ?? [];
    // Reihenfolge: code gewinnt (roh), dann link, außen bold/italic.
    if (marks.some((m) => m.type === "code")) {
      node = { kind: "code", text: n.text };
    }
    const link = marks.find((m) => m.type === "link");
    const href = typeof link?.attrs?.href === "string" ? link.attrs.href : null;
    if (href && isSafeHref(href) && node.kind !== "code") {
      node = { kind: "link", href: href.trim(), children: [node] };
    }
    if (marks.some((m) => m.type === "italic")) node = { kind: "italic", children: [node] };
    if (marks.some((m) => m.type === "bold")) node = { kind: "bold", children: [node] };
    out.push(node);
  }
  return out;
}

/** Text-Inhalt eines Knotens (Fallback für Nicht-Subset-Knoten). */
function textOf(node: DocNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(textOf).join("");
}

function itemInline(item: DocNode): InlineNode[] {
  // listItem → erste paragraph-Ebene; weitere Absätze werden angehängt.
  const paras = (item.content ?? []).filter((c) => c.type === "paragraph");
  return paras.flatMap((p, i) =>
    i === 0 ? docInline(p.content) : [{ kind: "text", text: ` ${textOf(p)}` } as InlineNode],
  );
}

function docNodeToBlock(node: DocNode): RichBlock | null {
  switch (node.type) {
    case "paragraph": {
      const inline = docInline(node.content);
      return inline.length > 0 ? { kind: "p", inline } : null;
    }
    case "heading": {
      const level = node.attrs?.level === 3 ? 3 : 2;
      return { kind: level === 3 ? "h3" : "h2", inline: docInline(node.content) };
    }
    case "bulletList":
      return { kind: "ul", items: (node.content ?? []).map(itemInline) };
    case "orderedList":
      return { kind: "ol", items: (node.content ?? []).map(itemInline) };
    case "blockquote": {
      const text = docInline((node.content ?? []).flatMap((c) => c.content ?? []));
      return { kind: "quote", inline: text };
    }
    case "codeBlock":
      return { kind: "code", text: textOf(node) };
    default: {
      // Nicht-Subset (z. B. horizontalRule): Text erhalten statt verlieren.
      const text = textOf(node).trim();
      return text.length > 0 ? { kind: "p", inline: [{ kind: "text", text }] } : null;
    }
  }
}

export function docToBlocks(doc: DocNode): string[] {
  return (doc.content ?? [])
    .map(docNodeToBlock)
    .filter((b): b is RichBlock => b !== null)
    .map(blockToString)
    .filter((s) => s.trim().length > 0);
}
