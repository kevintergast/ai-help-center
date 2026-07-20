"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/tenant/types";
import { TAG_COLORS, type ArticleFlag, type TagColor } from "@/lib/content/blocks";
import type {
  Article,
  ArticleStatus,
  ArticleTranslationInfo,
  ArticleVideo,
} from "@/lib/content/types";
import { getT } from "@/i18n/t";
import { cn } from "@/lib/ui/cn";
import {
  ArticleBlocksEditor,
  COLOR_KEYS,
  wrapBlocks,
  type EditorBlock,
} from "@/components/admin/article-blocks-editor";
import { ArticleImagesManager } from "@/components/admin/article-images";
import { ArticleVideosEditor } from "@/components/admin/article-videos-editor";
import { ArticleTranslations } from "@/components/admin/article-translations";
import { ARTICLE_STATUS } from "@/components/admin/status";
import { ArticleBlocksView } from "@/components/help-center/article-blocks-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Toast } from "@/components/ui/toast";
import { ArrowLeftIcon, PencilIcon } from "@/components/ui/icons";

interface Draft {
  title: string;
  category: string;
  status: ArticleStatus;
  blocks: EditorBlock[];
  videos: ArticleVideo[];
  flag: ArticleFlag | null;
}

const toDraft = (a: Article): Draft => ({
  title: a.title,
  category: a.category,
  status: a.status,
  blocks: wrapBlocks(a.body),
  videos: [...a.videos],
  flag: a.flag ?? null,
});

/** Vergleichsbasis OHNE Client-uids (die sind flüchtig, nie „dirty"). */
const essence = (d: Draft) => ({ ...d, blocks: d.blocks.map((w) => w.block) });

export function ArticleEditor({
  locale,
  article,
  translations = [],
}: {
  locale: Locale;
  article: Article;
  translations?: ArticleTranslationInfo[];
}) {
  const t = getT(locale);
  const router = useRouter();
  const statusOptions = (["current", "stale", "ai", "draft"] as ArticleStatus[]).map((s) => ({
    value: s,
    label: t(ARTICLE_STATUS[s].key),
  }));

  // `current` = veröffentlichter Stand (Ansichtsmodus). `draft` = Bearbeitungsstand.
  const [current, setCurrent] = useState<Draft>(() => toDraft(article));
  const [draft, setDraft] = useState<Draft>(current);
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const dirty = JSON.stringify(essence(draft)) !== JSON.stringify(essence(current));
  const dirtyInEdit = editing && dirty;

  // DATENVERLUST-SCHUTZ: Tab-Schließen/Navigation mit ungespeichertem Stand
  // fragt nach (der gemeldete Fall: Übersetzen/Wechsel warf den Entwurf weg).
  useEffect(() => {
    if (!dirtyInEdit) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyInEdit]);

  // ÜBERSETZUNGS-STALENESS: dieser Artikel ist eine Übersetzung und das
  // Original (Standardsprache) wurde seit seiner letzten Bearbeitung geändert.
  const self = translations.find((m) => m.id === article.id) ?? null;
  const original =
    article.locale !== locale ? (translations.find((m) => m.locale === locale) ?? null) : null;
  const translationStale = !!(original && self && original.updatedAt > self.updatedAt);
  const siblings = translations.filter((m) => m.id !== article.id);

  async function deleteArticle() {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/articles/${article.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete_failed");
      router.push("/admin/articles");
    } catch {
      setDeleteOpen(false);
      setSaving(false);
      showToast(t("editor.delete.error"));
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((c) => (c === message ? null : c)), 2600);
  }

  function enterEdit() {
    setDraft(current);
    setEditing(true);
  }
  function discard() {
    setDraft(current);
    setEditing(false);
  }

  /**
   * Speichert den Entwurf (PUT) und veröffentlicht ihn (POST /publish) gegen die
   * tenant-gebundene Content-API. Cookies (Session) gehen bei same-origin
   * automatisch mit; die API erzwingt requireTeam("content") + Tenant-Scope.
   * Verwandte werden hier NICHT gesendet → das Repo behält sie (Teil-Update);
   * Videos gehören seit der YouTube-Einbindung zum Entwurfs-Zyklus.
   */
  async function publish() {
    setSaving(true);
    try {
      const put = await fetch(`/api/v1/admin/articles/${article.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          category: draft.category,
          body: draft.blocks.map((w) => w.block),
          videos: draft.videos,
          flag: draft.flag,
        }),
      });
      if (!put.ok) throw new Error("save_failed");

      const pub = await fetch(`/api/v1/admin/articles/${article.id}/publish`, { method: "POST" });
      if (!pub.ok) throw new Error("publish_failed");

      setCurrent(draft);
      setEditing(false);
      setConfirmOpen(false);
      showToast(t("editor.publishedToast"));
    } catch {
      setConfirmOpen(false);
      showToast(t("editor.saveError"));
    } finally {
      setSaving(false);
    }
  }

  const setBlocks = (blocks: EditorBlock[]) => setDraft((d) => ({ ...d, blocks }));

  const view = editing ? draft : current;

  return (
    <div className={cn(editing && "pb-28")}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link
          href="/admin/articles"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeftIcon width={16} height={16} />
          {t("editor.back")}
        </Link>
        <div className="flex items-center gap-2">
          {/* Sprachwechsel im Editor: aktuelle Fassung + Geschwister-Chips.
              Bei ungespeicherten Änderungen deaktiviert (Datenverlust-Schutz). */}
          {siblings.length > 0 ? (
            <span className="mr-1 flex items-center gap-1.5">
              <span className="rounded-full border border-hairline bg-tint px-2 py-0.5 text-[11px] font-semibold uppercase text-ink-muted">
                {article.locale ?? locale}
              </span>
              {siblings.map((m) =>
                dirtyInEdit ? (
                  <span
                    key={m.id}
                    title={t("editor.translations.dirtyHint")}
                    className="cursor-not-allowed rounded-full border border-hairline bg-surface px-2 py-0.5 text-[11px] font-semibold uppercase text-ink-muted/50"
                  >
                    {m.locale}
                  </span>
                ) : (
                  <Link
                    key={m.id}
                    href={`/admin/articles/${m.id}`}
                    title={m.title}
                    className="rounded-full border border-hairline bg-surface px-2 py-0.5 text-[11px] font-semibold uppercase text-brand hover:underline"
                  >
                    {m.locale}
                  </Link>
                ),
              )}
            </span>
          ) : null}
          {editing ? (
            <Badge tone="brand" dot>
              {t("editor.mode")}
            </Badge>
          ) : (
            <Button variant="primary" size="sm" onClick={enterEdit}>
              <PencilIcon width={15} height={15} />
              {t("editor.edit")}
            </Button>
          )}
        </div>
      </div>

      {translationStale && original ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-comfy border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink">
          <span className="h-2 w-2 shrink-0 rounded-full bg-warn" />
          <span className="flex-1">
            {t("editor.translations.staleBanner", { locale: original.locale.toUpperCase() })}
          </span>
          <Link
            href={`/admin/articles/${original.id}`}
            className="text-sm font-medium text-brand hover:underline"
          >
            {t("editor.translations.staleOpenOriginal")}
          </Link>
        </div>
      ) : null}

      {editing ? (
        /* ————— Editor mode ————— */
        <div className="flex flex-col gap-6">
          <div className="grid gap-5 sm:grid-cols-[1fr_200px]">
            <Input
              label={t("editor.titleLabel")}
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-ink-muted">{t("editor.statusLabel")}</span>
              <Select
                options={statusOptions}
                value={draft.status}
                onValueChange={(v) => setDraft((d) => ({ ...d, status: v as ArticleStatus }))}
                aria-label={t("editor.statusLabel")}
                className="w-full"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label={t("editor.categoryLabel")}
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              className="max-w-xs"
            />
            {/* Artikel-FLAG (0024): Badge mit Paletten-Farbe; leer = keins. */}
            <Input
              label={t("editor.flag.label")}
              value={draft.flag?.text ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  flag:
                    e.target.value.trim().length === 0
                      ? null
                      : { text: e.target.value, color: d.flag?.color ?? "neutral" },
                }))
              }
              placeholder={t("editor.flag.placeholder")}
              className="w-44"
            />
            {draft.flag ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-ink-muted">{t("editor.flag.color")}</span>
                <Select
                  options={TAG_COLORS.map((c) => ({ value: c, label: t(COLOR_KEYS[c]) }))}
                  value={draft.flag.color}
                  onValueChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      flag: d.flag ? { text: d.flag.text, color: v as TagColor } : null,
                    }))
                  }
                  aria-label={t("editor.flag.color")}
                  className="w-36"
                />
              </div>
            ) : null}
          </div>

          <div>
            <span className="mb-2 block text-sm text-ink-muted">{t("editor.bodyLabel")}</span>
            {/* BLOCK-EDITOR: Reihenfolge der Blöcke = Reihenfolge im Artikel.
                Bilder wirken sofort (eigener Zyklus) — der Editor referenziert
                sie deshalb über article.images; Videos aus dem Entwurf. */}
            <ArticleBlocksEditor
              locale={locale}
              value={draft.blocks}
              onChange={setBlocks}
              images={article.images ?? []}
              videos={draft.videos}
              articleId={article.id}
            />
          </div>

          {/* Videos gehören zum Entwurf (mit „Veröffentlichen" gespeichert). */}
          <ArticleVideosEditor
            locale={locale}
            videos={draft.videos}
            onChange={(videos) => setDraft((d) => ({ ...d, videos }))}
          />

          {/* Bilder wirken sofort (eigener API-Zyklus, s. ArticleImagesManager). */}
          <ArticleImagesManager
            locale={locale}
            articleId={article.id}
            initialImages={article.images ?? []}
          />

          {/* Sprachfassungen (Translation-Set; KI-Übersetzung = Credits).
              dirty-Gate: Übersetzen/Wechseln erst nach dem Veröffentlichen —
              sonst ginge der ungespeicherte Entwurf bei der Navigation verloren. */}
          <ArticleTranslations
            locale={locale}
            articleId={article.id}
            members={translations}
            dirty={dirty}
          />

          {/* Gefahrenzone: Löschen entfernt DIESE Sprachfassung endgültig. */}
          <div className="border-t border-hairline pt-5">
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}>
              <span className="text-crit">{t("editor.delete.button")}</span>
            </Button>
          </div>
        </div>
      ) : (
        /* ————— View mode ————— */
        <article className="max-w-3xl">
          <span className="text-xs uppercase tracking-[0.04em] text-brand">{view.category}</span>
          <h1 className="mb-3 mt-1.5 text-[30px] font-semibold leading-tight tracking-[-0.6px] [text-wrap:balance]">
            {view.title}
          </h1>
          <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
            <Badge tone={ARTICLE_STATUS[view.status].tone} dot>
              {t(ARTICLE_STATUS[view.status].key)}
            </Badge>
            {view.flag ? <Badge tone={view.flag.color}>{view.flag.text}</Badge> : null}
            <span>{t("hc.updated", { when: article.updatedLabel })}</span>
            <span aria-hidden>·</span>
            <span>{t("hc.readingTime", { min: article.readingMinutes })}</span>
          </div>
          {/* Vorschau über den ECHTEN Public-Renderer (identisches Ergebnis);
              Bilder über die team-gegatete Admin-Route (zeigt auch Drafts). */}
          <ArticleBlocksView
            blocks={view.blocks.map((w) => w.block)}
            images={article.images ?? []}
            videos={view.videos}
            articleSlug={article.slug}
            videoPlayLabel={t("hc.videoPlay")}
            imageSrc={(imageId) => `/api/v1/admin/articles/${article.id}/images/${imageId}`}
          />
        </article>
      )}

      {/* Sticky publish bar (edit mode only) */}
      {editing ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3 md:px-8 lg:px-10">
            <span className="text-sm text-ink-muted">
              {dirty ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-warn" />
                  {t("editor.unsaved")}
                </span>
              ) : null}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={discard}>
                {t("editor.discard")}
              </Button>
              <Button variant="primary" size="sm" onClick={() => setConfirmOpen(true)}>
                {t("editor.publish")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("editor.confirmTitle")}
        closeLabel={t("editor.close")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
              {t("editor.cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={publish} disabled={saving}>
              {t("editor.confirmPublish")}
            </Button>
          </>
        }
      >
        {t("editor.confirmBody")}
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("editor.delete.title")}
        closeLabel={t("editor.close")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>
              {t("editor.cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={deleteArticle} disabled={saving}>
              {t("editor.delete.confirm")}
            </Button>
          </>
        }
      >
        {t("editor.delete.body")}
      </Dialog>

      <Toast
        open={toast !== null}
        message={toast}
        onClose={() => setToast(null)}
        closeLabel={t("editor.close")}
      />
    </div>
  );
}
