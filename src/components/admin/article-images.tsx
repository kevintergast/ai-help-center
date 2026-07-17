"use client";

import { useRef, useState } from "react";
import type { ArticleImage } from "@/lib/content/types";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { CloseIcon } from "@/components/ui/icons";

/**
 * BILDER-VERWALTUNG im Artikel-Editor (Content-Werkzeuge R2).
 *
 * Upload/Löschen wirken SOFORT (eigene API-Aufrufe, unabhängig vom
 * Entwurf/Veröffentlichen-Zyklus der Texte). Die BESCHREIBUNG ist Pflicht —
 * sie ist Alt-Text UND KI-Kontext (Architektur); ohne sie lehnt der Server
 * den Upload ab. Vorschau über die team-gegatete Admin-Route (zeigt auch
 * Drafts; öffentlich serviert werden nur Bilder veröffentlichter Artikel).
 */
export function ArticleImagesManager({
  locale,
  articleId,
  initialImages,
}: {
  locale: Locale;
  articleId: string;
  initialImages: ArticleImage[];
}) {
  const t = getT(locale);
  const fileRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<ArticleImage[]>(initialImages);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function errorText(code: string): string {
    switch (code) {
      case "image_description_required":
        return t("editor.images.errDescription");
      case "unsupported_image_type":
        return t("editor.images.errType");
      case "image_too_large":
        return t("editor.images.errSize");
      case "too_many_images":
        return t("editor.images.errLimit");
      default:
        return t("editor.images.errGeneric");
    }
  }

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(t("editor.images.errFile"));
      return;
    }
    if (description.trim().length === 0) {
      setError(t("editor.images.errDescription"));
      return;
    }
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
        setError(errorText(data?.error ?? "unknown"));
        return;
      }
      setImages((list) => [...list, data.image as ArticleImage]);
      setDescription("");
      if (fileRef.current) fileRef.current.value = "";
    } catch {
      setError(t("editor.images.errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(imageId: string) {
    setError(null);
    const res = await fetch(`/api/v1/admin/articles/${articleId}/images/${imageId}`, {
      method: "DELETE",
    }).catch(() => null);
    if (res?.ok) setImages((list) => list.filter((i) => i.id !== imageId));
    else setError(t("editor.images.errGeneric"));
  }

  return (
    <div>
      <span className="mb-1 block text-sm text-ink-muted">{t("editor.images.title")}</span>
      <p className="mb-3 text-xs text-ink-muted">{t("editor.images.hint")}</p>

      {images.length > 0 ? (
        <ul className="mb-4 grid gap-3 sm:grid-cols-2">
          {images.map((img) => (
            <li
              key={img.id}
              className="flex items-start gap-3 rounded-comfy border border-hairline bg-surface p-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/v1/admin/articles/${articleId}/images/${img.id}`}
                alt={img.description}
                className="h-16 w-16 shrink-0 rounded-md border border-hairline object-cover"
              />
              <span className="flex-1 text-sm text-ink">{img.description}</span>
              <IconButton
                aria-label={t("editor.images.delete")}
                onClick={() => void remove(img.id)}
                className="h-8 w-8 shrink-0 shadow-none"
              >
                <CloseIcon width={14} height={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-ink-muted">{t("editor.images.empty")}</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={t("editor.images.fileLabel")}
          className="text-sm text-ink-muted file:mr-3 file:rounded-full file:border file:border-hairline file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
        />
        <Input
          label={t("editor.images.descriptionLabel")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("editor.images.descriptionPlaceholder")}
          className="min-w-[260px] flex-1"
        />
        <Button variant="cream" size="sm" onClick={() => void upload()} disabled={busy}>
          {busy ? t("editor.images.uploading") : t("editor.images.upload")}
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-crit">{error}</p> : null}
    </div>
  );
}
