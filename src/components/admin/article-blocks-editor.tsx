"use client";

import type { ArticleBlock, TagColor, TextVariant } from "@/lib/content/blocks";
import { TAG_COLORS, TEXT_VARIANTS } from "@/lib/content/blocks";
import type { ArticleImage, ArticleVideo } from "@/lib/content/types";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import { ArticleBodyEditor } from "@/components/admin/article-body-editor";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CloseIcon } from "@/components/ui/icons";

/**
 * BLOCK-EDITOR des Artikel-Bodys: geordnete Liste typisierter Blöcke — die
 * Reihenfolge im Editor IST die Reihenfolge im Artikel. Text-Blöcke nutzen
 * den bestehenden Tiptap-Editor (Markdown-Subset inkl. Links); Code ist ein
 * Roh-Textfeld; Bild/Video referenzieren ANHÄNGE des Artikels; die
 * Artikel-Link-Card trägt eigenen Titel/Beschreibung + Tag (Paletten-Farbe).
 */

export interface EditorBlock {
  /** Stabile Client-Id (Tiptap-Remount bei Umordnen; NICHT persistiert). */
  uid: string;
  block: ArticleBlock;
}

export const wrapBlocks = (blocks: ArticleBlock[]): EditorBlock[] =>
  blocks.map((block) => ({ uid: crypto.randomUUID(), block }));

const toParagraphs = (text: string): string[] =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

const VARIANT_KEYS: Record<TextVariant, MessageKey> = {
  standard: "editor.blocks.variant.standard",
  info: "editor.blocks.variant.info",
  warning: "editor.blocks.variant.warning",
  error: "editor.blocks.variant.error",
  code: "editor.blocks.variant.code",
};

export const COLOR_KEYS: Record<TagColor, MessageKey> = {
  neutral: "editor.blocks.color.neutral",
  brand: "editor.blocks.color.brand",
  ok: "editor.blocks.color.ok",
  warn: "editor.blocks.color.warn",
  crit: "editor.blocks.color.crit",
};

export function ArticleBlocksEditor({
  locale,
  value,
  onChange,
  images,
  videos,
  articleId,
}: {
  locale: Locale;
  value: EditorBlock[];
  onChange: (next: EditorBlock[]) => void;
  images: ArticleImage[];
  videos: ArticleVideo[];
  articleId: string;
}) {
  const t = getT(locale);

  const update = (i: number, block: ArticleBlock) =>
    onChange(value.map((w, idx) => (idx === i ? { ...w, block } : w)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (block: ArticleBlock) =>
    onChange([...value, { uid: crypto.randomUUID(), block }]);

  const blockLabel = (b: ArticleBlock): string => {
    if (b.type === "text") return t(VARIANT_KEYS[b.variant]);
    if (b.type === "image") return t("editor.blocks.type.image");
    if (b.type === "video") return t("editor.blocks.type.video");
    return t("editor.blocks.type.card");
  };

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("editor.blocks.empty")}</p>
      ) : null}

      {value.map((w, i) => {
        const b = w.block;
        return (
          <div key={w.uid} className="rounded-comfy border border-hairline bg-surface">
            <div className="flex items-center gap-2 border-b border-hairline bg-tint px-3 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.04em] text-ink-muted">
                {blockLabel(b)}
              </span>
              {b.type === "text" ? (
                <Select
                  options={TEXT_VARIANTS.map((v) => ({ value: v, label: t(VARIANT_KEYS[v]) }))}
                  value={b.variant}
                  onValueChange={(v) => update(i, { ...b, variant: v as TextVariant })}
                  aria-label={t("editor.blocks.variantLabel")}
                  className="w-40"
                />
              ) : null}
              <span className="ml-auto flex items-center gap-1">
                <IconButton
                  aria-label={t("editor.blocks.moveUp")}
                  onClick={() => move(i, -1)}
                  className="h-7 w-7 shadow-none"
                >
                  ↑
                </IconButton>
                <IconButton
                  aria-label={t("editor.blocks.moveDown")}
                  onClick={() => move(i, 1)}
                  className="h-7 w-7 shadow-none"
                >
                  ↓
                </IconButton>
                <IconButton
                  aria-label={t("editor.blocks.remove")}
                  onClick={() => remove(i)}
                  className="h-7 w-7 shadow-none"
                >
                  <CloseIcon width={12} height={12} />
                </IconButton>
              </span>
            </div>

            <div className="p-3">
              {b.type === "text" ? (
                b.variant === "code" ? (
                  <textarea
                    value={b.text}
                    onChange={(e) => update(i, { ...b, text: e.target.value })}
                    rows={6}
                    aria-label={t("editor.blocks.variant.code")}
                    className="w-full rounded-std border border-hairline bg-surface-raised px-3 py-2 font-mono text-[13px] text-ink focus-visible:outline-none focus-visible:shadow-focusglow"
                  />
                ) : (
                  <ArticleBodyEditor
                    key={w.uid}
                    locale={locale}
                    initialBlocks={toParagraphs(b.text)}
                    onChange={(paragraphs) => update(i, { ...b, text: paragraphs.join("\n\n") })}
                  />
                )
              ) : b.type === "image" ? (
                <div className="flex items-center gap-3">
                  {(() => {
                    const img = images.find((im) => im.id === b.imageId);
                    return img && !img.pending ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/v1/admin/articles/${articleId}/images/${img.id}`}
                        alt={img.description}
                        className="h-14 w-14 shrink-0 rounded-md border border-hairline object-cover"
                      />
                    ) : null;
                  })()}
                  {images.length === 0 ? (
                    <span className="text-sm text-ink-muted">{t("editor.blocks.imageNone")}</span>
                  ) : (
                    <Select
                      options={images.map((im) => ({
                        value: im.id,
                        label: im.pending
                          ? `${im.description} (${t("editor.images.pendingBadge")})`
                          : im.description,
                      }))}
                      value={b.imageId}
                      onValueChange={(v) => update(i, { ...b, imageId: v })}
                      aria-label={t("editor.blocks.imageSelect")}
                      placeholder={t("editor.blocks.imageSelect")}
                      className="min-w-[260px]"
                    />
                  )}
                </div>
              ) : b.type === "video" ? (
                videos.length === 0 ? (
                  <span className="text-sm text-ink-muted">{t("editor.blocks.videoNone")}</span>
                ) : (
                  <Select
                    options={videos.map((v) => ({ value: v.id, label: v.title }))}
                    value={b.videoId}
                    onValueChange={(v) => update(i, { ...b, videoId: v })}
                    aria-label={t("editor.blocks.videoSelect")}
                    placeholder={t("editor.blocks.videoSelect")}
                    className="min-w-[260px]"
                  />
                )
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label={t("editor.blocks.cardSlug")}
                      value={b.slug}
                      onChange={(e) => update(i, { ...b, slug: e.target.value })}
                      placeholder={t("editor.blocks.cardSlugPlaceholder")}
                    />
                    <Input
                      label={t("editor.blocks.cardTitle")}
                      value={b.title}
                      onChange={(e) => update(i, { ...b, title: e.target.value })}
                    />
                  </div>
                  <Input
                    label={t("editor.blocks.cardDescription")}
                    value={b.description}
                    onChange={(e) => update(i, { ...b, description: e.target.value })}
                  />
                  <div className="flex flex-wrap items-end gap-3">
                    <Input
                      label={t("editor.blocks.tagText")}
                      value={b.tag?.text ?? ""}
                      onChange={(e) =>
                        update(i, {
                          ...b,
                          tag:
                            e.target.value.trim().length === 0
                              ? null
                              : { text: e.target.value, color: b.tag?.color ?? "neutral" },
                        })
                      }
                      placeholder={t("editor.blocks.tagPlaceholder")}
                      className="w-44"
                    />
                    {b.tag ? (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-sm text-ink-muted">{t("editor.blocks.tagColor")}</span>
                        <Select
                          options={TAG_COLORS.map((c) => ({ value: c, label: t(COLOR_KEYS[c]) }))}
                          value={b.tag.color}
                          onValueChange={(v) =>
                            update(i, { ...b, tag: { text: b.tag!.text, color: v as TagColor } })
                          }
                          aria-label={t("editor.blocks.tagColor")}
                          className="w-36"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2 rounded-comfy border border-dashed border-hairline-strong bg-tint px-3 py-2.5">
        <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-muted">
          {t("editor.blocks.add")}
        </span>
        <Button variant="cream" size="sm" onClick={() => add({ type: "text", variant: "standard", text: "" })}>
          {t("editor.blocks.variant.standard")}
        </Button>
        <Button variant="cream" size="sm" onClick={() => add({ type: "text", variant: "info", text: "" })}>
          {t("editor.blocks.variant.info")}
        </Button>
        <Button variant="cream" size="sm" onClick={() => add({ type: "text", variant: "warning", text: "" })}>
          {t("editor.blocks.variant.warning")}
        </Button>
        <Button variant="cream" size="sm" onClick={() => add({ type: "text", variant: "error", text: "" })}>
          {t("editor.blocks.variant.error")}
        </Button>
        <Button variant="cream" size="sm" onClick={() => add({ type: "text", variant: "code", text: "" })}>
          {t("editor.blocks.variant.code")}
        </Button>
        <Button
          variant="cream"
          size="sm"
          disabled={images.length === 0}
          title={images.length === 0 ? t("editor.blocks.imageNone") : undefined}
          onClick={() => add({ type: "image", imageId: images[0]?.id ?? "" })}
        >
          {t("editor.blocks.type.image")}
        </Button>
        <Button
          variant="cream"
          size="sm"
          disabled={videos.length === 0}
          title={videos.length === 0 ? t("editor.blocks.videoNone") : undefined}
          onClick={() => add({ type: "video", videoId: videos[0]?.id ?? "" })}
        >
          {t("editor.blocks.type.video")}
        </Button>
        <Button
          variant="cream"
          size="sm"
          onClick={() => add({ type: "articleLink", slug: "", title: "", description: "", tag: null })}
        >
          {t("editor.blocks.type.card")}
        </Button>
      </div>
    </div>
  );
}
