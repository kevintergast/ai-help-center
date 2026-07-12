"use client";

import { useState } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/tenant/types";
import type { Article, ArticleStatus } from "@/lib/content/types";
import { getT } from "@/i18n/t";
import { cn } from "@/lib/ui/cn";
import { ARTICLE_STATUS } from "@/components/admin/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Toast } from "@/components/ui/toast";
import { ArrowLeftIcon, PencilIcon, PlusIcon, CloseIcon } from "@/components/ui/icons";

interface Draft {
  title: string;
  category: string;
  status: ArticleStatus;
  blocks: string[];
}

const toDraft = (a: { title: string; category: string; status: ArticleStatus; body: string[] }): Draft => ({
  title: a.title,
  category: a.category,
  status: a.status,
  blocks: [...a.body],
});

export function ArticleEditor({ locale, article }: { locale: Locale; article: Article }) {
  const t = getT(locale);
  const statusOptions = (["current", "stale", "ai", "draft"] as ArticleStatus[]).map((s) => ({
    value: s,
    label: t(ARTICLE_STATUS[s].key),
  }));

  // `current` = veröffentlichter Stand (Ansichtsmodus). `draft` = Bearbeitungsstand.
  const [current, setCurrent] = useState<Draft>(() => toDraft(article));
  const [draft, setDraft] = useState<Draft>(current);
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(current);

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
   * Videos/Verwandte werden hier NICHT gesendet → das Repo behält sie (Teil-Update).
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
          body: draft.blocks,
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

  const setBlock = (i: number, v: string) =>
    setDraft((d) => ({ ...d, blocks: d.blocks.map((b, j) => (j === i ? v : b)) }));
  const addBlock = () => setDraft((d) => ({ ...d, blocks: [...d.blocks, ""] }));
  const removeBlock = (i: number) =>
    setDraft((d) => ({ ...d, blocks: d.blocks.filter((_, j) => j !== i) }));

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
          <Input
            label={t("editor.categoryLabel")}
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
            className="max-w-xs"
          />

          <div>
            <span className="mb-2 block text-sm text-ink-muted">{t("editor.bodyLabel")}</span>
            <div className="flex flex-col gap-3">
              {draft.blocks.map((b, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Textarea
                    value={b}
                    placeholder={t("editor.blockPlaceholder")}
                    onChange={(e) => setBlock(i, e.target.value)}
                    className="flex-1"
                  />
                  <IconButton
                    aria-label={t("editor.removeBlock")}
                    onClick={() => removeBlock(i)}
                    className="mt-1 h-9 w-9 shadow-none"
                  >
                    <CloseIcon width={16} height={16} />
                  </IconButton>
                </div>
              ))}
            </div>
            <Button variant="cream" size="sm" onClick={addBlock} className="mt-3">
              <PlusIcon width={15} height={15} />
              {t("editor.addBlock")}
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
            <span>{t("hc.updated", { when: article.updatedLabel })}</span>
            <span aria-hidden>·</span>
            <span>{t("hc.readingTime", { min: article.readingMinutes })}</span>
          </div>
          <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-ink">
            {view.blocks.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
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

      <Toast
        open={toast !== null}
        message={toast}
        onClose={() => setToast(null)}
        closeLabel={t("editor.close")}
      />
    </div>
  );
}
