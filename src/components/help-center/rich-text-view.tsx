import type { ReactNode } from "react";
import { parseBlocks, type InlineNode } from "@/lib/content/rich-text";

/**
 * SICHERER Renderer des Artikel-Rich-Text-Subsets (rich-text.ts): baut
 * ausschließlich React-Elemente aus geparsten Knoten — es gibt keinen
 * HTML-String-Pfad (kein dangerouslySetInnerHTML), Links sind bereits im
 * Parser auf http(s) whitelisted und öffnen extern mit rel-Schutz.
 * Server-Komponenten-tauglich (pur, kein State).
 */

function renderInline(nodes: InlineNode[], keyPrefix = ""): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}${i}`;
    switch (n.kind) {
      case "text":
        return n.text;
      case "bold":
        return <strong key={key}>{renderInline(n.children, `${key}.`)}</strong>;
      case "italic":
        return <em key={key}>{renderInline(n.children, `${key}.`)}</em>;
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-tint px-1.5 py-0.5 font-mono text-[0.9em] text-ink"
          >
            {n.text}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
          >
            {renderInline(n.children, `${key}.`)}
          </a>
        );
    }
  });
}

export function RichTextView({ body }: { body: string[] }) {
  const blocks = parseBlocks(body);
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "h2":
            return (
              <h2 key={i} className="mt-2 text-xl font-semibold tracking-[-0.3px] text-ink">
                {renderInline(block.inline)}
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} className="mt-1 text-base font-semibold text-ink">
                {renderInline(block.inline)}
              </h3>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1.5 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `${j}.`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1.5 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `${j}.`)}</li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote
                key={i}
                className="border-l-2 border-brand/40 pl-4 text-ink-muted"
              >
                {renderInline(block.inline)}
              </blockquote>
            );
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-comfy border border-hairline bg-tint p-4 font-mono text-sm text-ink"
              >
                <code>{block.text}</code>
              </pre>
            );
          default:
            return <p key={i}>{renderInline(block.inline)}</p>;
        }
      })}
    </>
  );
}
