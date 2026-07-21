"use client";

import { useRef, useState } from "react";
import type { ArticleBlock, TagColor, TextVariant } from "@/lib/content/blocks";
import { TAG_COLORS, TEXT_VARIANTS } from "@/lib/content/blocks";
import {
  insertBlockAt,
  moveBlock,
  removeBlockAt,
  unplacedAttachments,
  upsertVideoForBlock,
  type EditorBlock,
} from "@/lib/admin/block-draft";
import type { ArticleImage, ArticleVideo } from "@/lib/content/types";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import { parseYouTubeId } from "@/server/content/validate";
import { ArticleBodyEditor } from "@/components/admin/article-body-editor";
import {
  SingleBlockView,
  type BlockViewContext,
} from "@/components/help-center/article-blocks-view";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CloseIcon, PencilIcon } from "@/components/ui/icons";

/**
 * WYSIWYG-BLOCK-EDITOR: Der Entwurf sieht aus wie der veröffentlichte
 * Artikel (SingleBlockView = derselbe Renderer wie public). Jede Box trägt
 * RUNDE Aktions-Buttons oben rechts (Bearbeiten-Toggle, ↑, ↓, ✕); zwischen
 * den Blöcken liegen feine PLUS-LINIEN, über die man an genau dieser Stelle
 * einen Block einfügt (Typ-Menü) — neue Blöcke öffnen direkt im Edit-Zustand.
 *
 * BILD/VIDEO ohne separate Sektionen: Die Eingaben leben IM Block.
 *  - Bild: Beschreibung + Datei → Upload SOFORT (eigener API-Zyklus, R2);
 *    der Block referenziert danach den Anhang und rendert das echte Bild.
 *  - Video: YouTube-URL/Titel/Beschreibung im Block; der Video-Eintrag hängt
 *    am Entwurfs-Zyklus und ist an seinen Block GEKOPPELT (block-draft.ts).
 * Verwaiste/vorgemerkte Anhänge sammelt die „Nicht platziert"-Leiste unten
 * (Platzieren / Vormerkung erfüllen / Löschen) — sie erscheint nur bei Bedarf.
 */

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

const toParagraphs = (text: string): string[] =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

type AddKind =
  | { kind: "text"; variant: TextVariant }
  | { kind: "image" }
  | { kind: "video" }
  | { kind: "card" };

function blankBlock(pick: AddKind): ArticleBlock {
  switch (pick.kind) {
    case "text":
      return { type: "text", variant: pick.variant, text: "" };
    case "image":
      return { type: "image", imageId: "" };
    case "video":
      return { type: "video", videoId: "" };
    case "card":
      return { type: "articleLink", slug: "", title: "", description: "", tag: null };
  }
}

/** Rundes schwebendes Aktions-Icon (Box-Ecke oben rechts). */
function RoundAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <IconButton
      aria-label={label}
      title={label}
      onClick={onClick}
      className="h-8 w-8 rounded-full border border-hairline bg-surface shadow-sm"
    >
      {children}
    </IconButton>
  );
}

/** Bild-Upload IM Block (und für Vormerkungen in der Leiste). */
function ImageUploadForm({
  locale,
  articleId,
  initialDescription = "",
  submitLabel,
  onUploaded,
}: {
  locale: Locale;
  articleId: string;
  initialDescription?: string;
  submitLabel: string;
  onUploaded: (image: ArticleImage) => void | Promise<void>;
}) {
  const t = getT(locale);
  const fileRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError(t("editor.images.errFile"));
    if (description.trim().length === 0) return setError(t("editor.images.errDescription"));
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("description", description.trim());
      const res = await fetch(`/api/v1/admin/articles/${articleId}/images`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; image?: ArticleImage }
        | null;
      if (!res.ok || !data?.image) {
        setError(t("editor.images.errGeneric"));
        return;
      }
      await onUploaded(data.image);
    } catch {
      setError(t("editor.images.errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        label={t("editor.images.descriptionLabel")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("editor.images.descriptionPlaceholder")}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={t("editor.images.fileLabel")}
          className="text-sm text-ink-muted file:mr-3 file:rounded-full file:border file:border-hairline file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
        />
        <Button variant="cream" size="sm" onClick={() => void upload()} disabled={busy}>
          {busy ? t("editor.images.uploading") : submitLabel}
        </Button>
      </div>
      {error ? <p className="text-xs text-crit">{error}</p> : null}
    </div>
  );
}

/** Video-Eingaben IM Block (Publish-Zyklus; identische Validierung wie Server). */
function VideoBlockForm({
  locale,
  existing,
  onApply,
}: {
  locale: Locale;
  existing: ArticleVideo | null;
  onApply: (video: ArticleVideo) => void;
}) {
  const t = getT(locale);
  const [url, setUrl] = useState(existing?.youtubeId ? `https://youtu.be/${existing.youtubeId}` : "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [duration, setDuration] = useState(existing?.durationLabel ?? "");
  const [error, setError] = useState<string | null>(null);

  function apply() {
    setError(null);
    const youtubeId = parseYouTubeId(url);
    if (!youtubeId) return setError(t("editor.videos.errUrl"));
    if (title.trim().length === 0) return setError(t("editor.videos.errTitle"));
    if (description.trim().length === 0) return setError(t("editor.videos.errDescription"));
    onApply({
      id: existing?.id ?? crypto.randomUUID(),
      title: title.trim(),
      durationLabel: duration.trim(),
      description: description.trim(),
      youtubeId,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          label={t("editor.videos.urlLabel")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
        />
        <Input
          label={t("editor.videos.titleLabel")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("editor.videos.titlePlaceholder")}
        />
        <Input
          label={t("editor.videos.descriptionLabel")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("editor.videos.descriptionPlaceholder")}
        />
        <Input
          label={t("editor.videos.durationLabel")}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          placeholder="3:20"
          className="max-w-[140px]"
        />
      </div>
      <div>
        <Button variant="cream" size="sm" onClick={apply}>
          {t("editor.blocks.videoApply")}
        </Button>
      </div>
      {error ? <p className="text-xs text-crit">{error}</p> : null}
    </div>
  );
}

export function ArticleBlocksEditor({
  locale,
  value,
  onChange,
  images,
  onImagesChange,
  videos,
  onVideosChange,
  articleId,
  videoPlayLabel,
}: {
  locale: Locale;
  value: EditorBlock[];
  onChange: (next: EditorBlock[]) => void;
  images: ArticleImage[];
  onImagesChange: (next: ArticleImage[]) => void;
  videos: ArticleVideo[];
  onVideosChange: (next: ArticleVideo[]) => void;
  articleId: string;
  videoPlayLabel: string;
}) {
  const t = getT(locale);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState<number | null>(null);

  const ctx: BlockViewContext = {
    images,
    videos,
    videoPlayLabel,
    srcFor: (id) => `/api/v1/admin/articles/${articleId}/images/${id}`,
  };

  const pickAt = (index: number, pick: AddKind) => {
    const { next, uid } = insertBlockAt(value, index, blankBlock(pick));
    onChange(next);
    setEditingUid(uid);
    setMenuAt(null);
  };

  const update = (i: number, block: ArticleBlock) =>
    onChange(value.map((w, idx) => (idx === i ? { ...w, block } : w)));

  const removeAt = (i: number) => {
    const res = removeBlockAt(value, i, videos);
    onChange(res.blocks);
    onVideosChange(res.videos);
  };

  const blockLabel = (b: ArticleBlock): string => {
    if (b.type === "text") return t(VARIANT_KEYS[b.variant]);
    if (b.type === "image") return t("editor.blocks.type.image");
    if (b.type === "video") return t("editor.blocks.type.video");
    return t("editor.blocks.type.card");
  };

  /** Plus-Linie an `index` (0 = vor dem ersten Block, length = Ende). */
  const InsertLine = ({ index, area = false }: { index: number; area?: boolean }) => (
    <div className={area ? "" : "group/insert relative -my-1.5 py-1.5"}>
      {menuAt === index ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-comfy border border-hairline bg-surface p-2 shadow-sm">
          {TEXT_VARIANTS.map((v) => (
            <Button key={v} variant="cream" size="sm" onClick={() => pickAt(index, { kind: "text", variant: v })}>
              {t(VARIANT_KEYS[v])}
            </Button>
          ))}
          <Button variant="cream" size="sm" onClick={() => pickAt(index, { kind: "image" })}>
            {t("editor.blocks.type.image")}
          </Button>
          <Button variant="cream" size="sm" onClick={() => pickAt(index, { kind: "video" })}>
            {t("editor.blocks.type.video")}
          </Button>
          <Button variant="cream" size="sm" onClick={() => pickAt(index, { kind: "card" })}>
            {t("editor.blocks.type.card")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMenuAt(null)}>
            {t("editor.cancel")}
          </Button>
        </div>
      ) : area ? (
        <button
          type="button"
          onClick={() => setMenuAt(index)}
          className="flex w-full items-center justify-center gap-2 rounded-comfy border border-dashed border-hairline-strong bg-tint px-3 py-3 text-sm text-ink-muted transition-colors hover:border-brand hover:text-brand"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full border border-current text-base leading-none">+</span>
          {t("editor.blocks.insertHere")}
        </button>
      ) : (
        <div className="relative flex items-center justify-center">
          <span className="h-px w-full bg-hairline opacity-0 transition-opacity group-hover/insert:opacity-100" />
          <button
            type="button"
            onClick={() => setMenuAt(index)}
            aria-label={t("editor.blocks.insertHere")}
            title={t("editor.blocks.insertHere")}
            className="absolute grid h-6 w-6 place-items-center rounded-full border border-hairline bg-surface text-sm leading-none text-ink-muted opacity-0 shadow-sm transition-opacity hover:border-brand hover:text-brand group-hover/insert:opacity-100"
          >
            +
          </button>
        </div>
      )}
    </div>
  );

  const unplaced = unplacedAttachments(value, images, videos);

  return (
    <div className="flex flex-col gap-1.5">
      {value.map((w, i) => {
        const b = w.block;
        const editing = editingUid === w.uid;
        return (
          <div key={w.uid}>
            <InsertLine index={i} />
            <div
              className={`group relative rounded-comfy ${
                editing
                  ? "ring-2 ring-brand/40"
                  : "ring-1 ring-transparent transition-shadow hover:ring-hairline-strong"
              }`}
            >
              {/* Runde Aktions-Buttons an der Box-Ecke (Kevins Vorgabe). */}
              <span className="absolute -top-3.5 right-2 z-10 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <RoundAction
                  label={editing ? t("editor.blocks.doneEditing") : t("editor.blocks.editBlock")}
                  onClick={() => setEditingUid(editing ? null : w.uid)}
                >
                  {editing ? "✓" : <PencilIcon width={13} height={13} />}
                </RoundAction>
                <RoundAction label={t("editor.blocks.moveUp")} onClick={() => onChange(moveBlock(value, i, -1))}>
                  ↑
                </RoundAction>
                <RoundAction label={t("editor.blocks.moveDown")} onClick={() => onChange(moveBlock(value, i, 1))}>
                  ↓
                </RoundAction>
                <RoundAction label={t("editor.blocks.remove")} onClick={() => removeAt(i)}>
                  <CloseIcon width={12} height={12} />
                </RoundAction>
              </span>

              {editing ? (
                <div className="rounded-comfy border border-hairline bg-surface p-3">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.04em] text-ink-muted">
                    {blockLabel(b)}
                  </span>
                  {b.type === "text" ? (
                    <div className="flex flex-col gap-2">
                      <Select
                        options={TEXT_VARIANTS.map((v) => ({ value: v, label: t(VARIANT_KEYS[v]) }))}
                        value={b.variant}
                        onValueChange={(v) => update(i, { ...b, variant: v as TextVariant })}
                        aria-label={t("editor.blocks.variantLabel")}
                        className="w-44"
                      />
                      {b.variant === "code" ? (
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
                      )}
                    </div>
                  ) : b.type === "image" ? (
                    <ImageUploadForm
                      locale={locale}
                      articleId={articleId}
                      initialDescription={images.find((im) => im.id === b.imageId)?.description ?? ""}
                      submitLabel={
                        b.imageId ? t("editor.blocks.imageReplace") : t("editor.blocks.imageUpload")
                      }
                      onUploaded={(image) => {
                        onImagesChange([...images, image]);
                        update(i, { ...b, imageId: image.id });
                        setEditingUid(null);
                      }}
                    />
                  ) : b.type === "video" ? (
                    <VideoBlockForm
                      locale={locale}
                      existing={videos.find((v) => v.id === b.videoId) ?? null}
                      onApply={(video) => {
                        const res = upsertVideoForBlock(value, w.uid, videos, video);
                        onChange(res.blocks);
                        onVideosChange(res.videos);
                        setEditingUid(null);
                      }}
                    />
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
              ) : (
                (() => {
                  // WYSIWYG: exakt die veröffentlichte Darstellung. Leere/
                  // unaufgelöste Referenzen bekommen eine Platzhalter-Kachel,
                  // damit der Block greifbar bleibt (SingleBlockView → null).
                  const isEmptyRef =
                    (b.type === "image" &&
                      !images.some((im) => im.id === b.imageId && !im.pending)) ||
                    (b.type === "video" && !videos.some((v) => v.id === b.videoId)) ||
                    (b.type === "text" && b.text.trim().length === 0) ||
                    (b.type === "articleLink" && b.title.trim().length === 0);
                  if (isEmptyRef) {
                    return (
                      <button
                        type="button"
                        onClick={() => setEditingUid(w.uid)}
                        className="flex w-full items-center gap-2 rounded-comfy border border-dashed border-hairline-strong bg-tint px-4 py-4 text-sm text-ink-muted hover:border-brand hover:text-brand"
                      >
                        <PencilIcon width={14} height={14} />
                        {t("editor.blocks.emptyBlock", { type: blockLabel(b) })}
                      </button>
                    );
                  }
                  return <SingleBlockView block={b} ctx={ctx} />;
                })()
              )}
            </div>
          </div>
        );
      })}

      <div className="mt-1.5">
        <InsertLine index={value.length} area />
      </div>

      {unplaced.images.length > 0 || unplaced.videos.length > 0 ? (
        <div className="mt-4 rounded-comfy border border-hairline bg-tint p-3">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.04em] text-ink-muted">
            {t("editor.blocks.unplacedTitle")}
          </span>
          <p className="mb-2 text-xs text-ink-muted">{t("editor.blocks.unplacedHint")}</p>
          <ul className="flex flex-col gap-2">
            {unplaced.images.map((im) => (
              <li key={im.id} className="flex flex-wrap items-center gap-3 rounded-std border border-hairline bg-surface px-3 py-2">
                {im.pending ? (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-dashed border-hairline text-ink-muted">?</span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/v1/admin/articles/${articleId}/images/${im.id}`}
                    alt={im.description}
                    className="h-10 w-10 shrink-0 rounded-md border border-hairline object-cover"
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {im.pending ? (
                    <span className="mr-1.5 text-xs font-medium text-warn">{t("editor.images.pendingBadge")}</span>
                  ) : null}
                  {im.description}
                </span>
                {!im.pending ? (
                  <Button
                    variant="cream"
                    size="sm"
                    onClick={() => {
                      const { next } = insertBlockAt(value, value.length, { type: "image", imageId: im.id });
                      onChange(next);
                    }}
                  >
                    {t("editor.blocks.place")}
                  </Button>
                ) : (
                  <Button
                    variant="cream"
                    size="sm"
                    onClick={() => {
                      const { next, uid } = insertBlockAt(value, value.length, { type: "image", imageId: im.id });
                      onChange(next);
                      setEditingUid(uid);
                    }}
                  >
                    {t("editor.images.pendingUpload")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void fetch(`/api/v1/admin/articles/${articleId}/images/${im.id}`, {
                      method: "DELETE",
                    }).then((res) => {
                      if (res.ok) onImagesChange(images.filter((x) => x.id !== im.id));
                    });
                  }}
                >
                  {t("editor.blocks.deleteAttachment")}
                </Button>
              </li>
            ))}
            {unplaced.videos.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 rounded-std border border-hairline bg-surface px-3 py-2">
                {v.youtubeId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://i.ytimg.com/vi/${v.youtubeId}/mqdefault.jpg`}
                    alt={v.description}
                    className="h-10 w-16 shrink-0 rounded-md border border-hairline object-cover"
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{v.title}</span>
                <Button
                  variant="cream"
                  size="sm"
                  onClick={() => {
                    const { next } = insertBlockAt(value, value.length, { type: "video", videoId: v.id });
                    onChange(next);
                  }}
                >
                  {t("editor.blocks.place")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onVideosChange(videos.filter((x) => x.id !== v.id))}
                >
                  {t("editor.blocks.deleteAttachment")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
