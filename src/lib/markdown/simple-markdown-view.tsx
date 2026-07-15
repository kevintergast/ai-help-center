import type { ReactNode } from "react";
import { parseBlocks, type InlineToken } from "./simple-markdown";

/**
 * React-Ansicht zum sicheren Markdown-Parser (simple-markdown.ts): rendert
 * ausschließlich Token-Strukturen — kein `dangerouslySetInnerHTML`, kein
 * Roh-HTML-Pfad (Design h). Server-kompatibel (keine Hooks).
 */

function renderInline(tokens: InlineToken[]): ReactNode[] {
  return tokens.map((token, i) => {
    switch (token.kind) {
      case "bold":
        return <strong key={i}>{token.text}</strong>;
      case "italic":
        return <em key={i}>{token.text}</em>;
      case "code":
        return (
          <code key={i} className="rounded bg-tint px-1 py-0.5 text-[0.9em]">
            {token.text}
          </code>
        );
      case "link":
        return (
          <a
            key={i}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline underline-offset-2 hover:opacity-80"
          >
            {token.text}
          </a>
        );
      default:
        return token.text;
    }
  });
}

export function SimpleMarkdown({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);
  return (
    <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-ink">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading": {
            const inline = renderInline(block.inline);
            if (block.level === 1)
              return (
                <h1 key={i} className="mt-2 text-[26px] font-semibold tracking-[-0.5px]">
                  {inline}
                </h1>
              );
            if (block.level === 2)
              return (
                <h2 key={i} className="mt-2 text-xl font-semibold tracking-[-0.3px]">
                  {inline}
                </h2>
              );
            return (
              <h3 key={i} className="mt-1 text-base font-semibold">
                {inline}
              </h3>
            );
          }
          case "list":
            return block.ordered ? (
              <ol key={i} className="list-decimal pl-6">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            ) : (
              <ul key={i} className="list-disc pl-6">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case "hr":
            return <hr key={i} className="border-hairline" />;
          default:
            return <p key={i}>{renderInline(block.inline)}</p>;
        }
      })}
    </div>
  );
}
