"use client";

import { useState } from "react";
import type { ArticleVideo } from "@/lib/content/types";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { parseYouTubeId } from "@/server/content/validate";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { CloseIcon } from "@/components/ui/icons";

/**
 * VIDEOS-Sektion im Artikel-Editor (v1: nur YouTube, User-Entscheidung
 * 2026-07-17). Teil des ENTWURFS-Zyklus: Änderungen landen im Draft und
 * werden erst mit „Veröffentlichen" gespeichert (PUT sendet `videos` mit) —
 * anders als Bilder (Binärdaten → sofortiger eigener API-Zyklus).
 *
 * Die BESCHREIBUNG ist Pflicht (a11y + KI-Kontext — Video-Inhalte werden
 * darüber Teil der KI-Antworten); die YouTube-URL wird client-seitig sofort
 * validiert (parseYouTubeId — dieselbe Funktion prüft serverseitig).
 */
export function ArticleVideosEditor({
  locale,
  videos,
  onChange,
}: {
  locale: Locale;
  videos: ArticleVideo[];
  onChange: (videos: ArticleVideo[]) => void;
}) {
  const t = getT(locale);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    const youtubeId = parseYouTubeId(url);
    if (!youtubeId) {
      setError(t("editor.videos.errUrl"));
      return;
    }
    if (title.trim().length === 0) {
      setError(t("editor.videos.errTitle"));
      return;
    }
    if (description.trim().length === 0) {
      setError(t("editor.videos.errDescription"));
      return;
    }
    onChange([
      ...videos,
      {
        id: crypto.randomUUID(),
        title: title.trim(),
        durationLabel: duration.trim(),
        description: description.trim(),
        youtubeId,
      },
    ]);
    setUrl("");
    setTitle("");
    setDescription("");
    setDuration("");
  }

  return (
    <div>
      <span className="mb-1 block text-sm text-ink-muted">{t("editor.videos.title")}</span>
      <p className="mb-3 text-xs text-ink-muted">{t("editor.videos.hint")}</p>

      {videos.length > 0 ? (
        <ul className="mb-4 grid gap-3 sm:grid-cols-2">
          {videos.map((v) => (
            <li
              key={v.id}
              className="flex items-start gap-3 rounded-comfy border border-hairline bg-surface p-3"
            >
              {v.youtubeId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`https://i.ytimg.com/vi/${v.youtubeId}/mqdefault.jpg`}
                  alt={v.description}
                  className="h-14 w-24 shrink-0 rounded-md border border-hairline object-cover"
                />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{v.title}</span>
                <span className="block truncate text-xs text-ink-muted">{v.description}</span>
              </span>
              <IconButton
                aria-label={t("editor.videos.delete")}
                onClick={() => onChange(videos.filter((x) => x.id !== v.id))}
                className="h-8 w-8 shrink-0 shadow-none"
              >
                <CloseIcon width={14} height={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-ink-muted">{t("editor.videos.empty")}</p>
      )}

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
      <Button variant="cream" size="sm" onClick={add} className="mt-3">
        {t("editor.videos.add")}
      </Button>
      {error ? <p className="mt-2 text-xs text-crit">{error}</p> : null}
    </div>
  );
}
