"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { blocksToDoc, docToBlocks, type DocNode } from "@/lib/content/rich-doc";
import { isSafeHref } from "@/lib/content/rich-text";
import { cn } from "@/lib/ui/cn";

/**
 * TIPTAP-EDITOR des Artikel-Bodys (Architektur: „Editor: Tiptap, block-basiert,
 * admin-gated"). Die Wahrheit bleibt das Block-Modell (string[]-Subset,
 * rich-text.ts): geladen wird via blocksToDoc, bei jeder Änderung serialisiert
 * docToBlocks zurück — der Editor ist reine Schreiboberfläche, es entsteht
 * NIE HTML als Speicherformat. Toolbar bewusst aufs Subset beschränkt.
 */

const BUTTON =
  "rounded-md border border-transparent px-2 py-1 text-sm text-ink-muted transition-colors hover:text-ink";
const ACTIVE = "border-hairline bg-tint text-ink";

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => {
        e.preventDefault(); // Fokus im Editor halten
        onClick();
      }}
      className={cn(BUTTON, active && ACTIVE)}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, locale }: { editor: Editor; locale: Locale }) {
  const t = getT(locale);

  function setLink() {
    const previous = (editor.getAttributes("link").href as string | undefined) ?? "";
    // window.prompt reicht fürs Subset (ein Feld, validiert) — kein Dialog-Bau.
    const url = window.prompt(t("editor.rich.linkPrompt"), previous);
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const href = /^https?:\/\//i.test(url) ? url.trim() : `https://${url.trim()}`;
    if (!isSafeHref(href)) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-hairline px-2 py-1.5">
      <ToolbarButton
        label={t("editor.rich.h2")}
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <span className="font-semibold">H2</span>
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.rich.h3")}
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <span className="font-semibold">H3</span>
      </ToolbarButton>
      <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
      <ToolbarButton
        label={t("editor.rich.bold")}
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <span className="font-bold">B</span>
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.rich.italic")}
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.rich.code")}
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <span className="font-mono text-xs">{"<>"}</span>
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.rich.link")}
        active={editor.isActive("link")}
        onClick={setLink}
      >
        <span className="underline underline-offset-2">URL</span>
      </ToolbarButton>
      <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
      <ToolbarButton
        label={t("editor.rich.ul")}
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <span aria-hidden>••</span>
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.rich.ol")}
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <span aria-hidden>1.</span>
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.rich.quote")}
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <span aria-hidden>&ldquo;&rdquo;</span>
      </ToolbarButton>
      <ToolbarButton
        label={t("editor.rich.codeBlock")}
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <span className="font-mono text-xs">```</span>
      </ToolbarButton>
    </div>
  );
}

export function ArticleBodyEditor({
  locale,
  initialBlocks,
  onChange,
}: {
  locale: Locale;
  initialBlocks: string[];
  onChange: (blocks: string[]) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
    ],
    content: blocksToDoc(initialBlocks) as object,
    // SSR-Hydration: Next rendert die Seite server-seitig — Tiptap erst am Client.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "tiptap-body min-h-[280px] px-4 py-3 text-[15px] leading-relaxed text-ink focus:outline-none",
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange(docToBlocks(e.getJSON() as DocNode));
    },
  });

  if (!editor) {
    return (
      <div className="min-h-[280px] rounded-comfy border border-hairline bg-surface" aria-hidden />
    );
  }

  return (
    <div className="overflow-hidden rounded-comfy border border-hairline bg-surface focus-within:border-brand/50">
      <Toolbar editor={editor} locale={locale} />
      <EditorContent editor={editor} />
    </div>
  );
}
