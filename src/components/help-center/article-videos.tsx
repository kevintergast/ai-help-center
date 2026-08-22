"use client";

import { useState } from "react";
import type { ArticleVideo } from "@/lib/content/types";
import { PlayIcon } from "@/components/ui/icons";

/**
 * VIDEO-KARTE (Artikelseite + Inline-Video-Block).
 *
 * KLICK-ZUM-LADEN: Bis zum Klick wird nur das YouTube-Vorschaubild geladen;
 * der Player (iframe) kommt erst danach — und dann über die
 * youtube-NOCOOKIE-Domain (privacy-enhanced Mode). Videos ohne youtubeId
 * (Altbestand) rendern als nicht-klickbare Karte.
 *
 * DESIGN (2026-08-22): Auf dem abgedunkelten Vorschaubild ist alles WEISS —
 * Play-Symbol, Rahmen, Dauer-Badge (ein dunkles Symbol auf dunklem Grund war
 * schlecht lesbar). Der Verlauf von unten hält den Titel-Bereich ruhig, ohne
 * das ganze Bild flach zu grauen.
 */
export function ArticleVideos({
  videos,
  playLabel,
}: {
  videos: ArticleVideo[];
  playLabel: string;
}) {
  const [playing, setPlaying] = useState<string | null>(null);

  return (
    <ul className="flex flex-col gap-3">
      {videos.map((v) => (
        <li key={v.id}>
          <div className="overflow-hidden rounded-card border border-hairline bg-surface">
            {playing === v.id && v.youtubeId ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${v.youtubeId}?autoplay=1`}
                title={v.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="aspect-video w-full border-0"
              />
            ) : v.youtubeId ? (
              <button
                type="button"
                onClick={() => setPlaying(v.id)}
                aria-label={`${playLabel}: ${v.title}`}
                className="group relative block w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`}
                  alt={v.description}
                  loading="lazy"
                  className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
                {/* Sanfte Abdunklung: oben nur leicht, unten stärker (Kontrast
                    fürs Dauer-Badge), damit das Vorschaubild sichtbar bleibt. */}
                <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-black/15 transition-opacity duration-300 group-hover:from-black/60" />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/40 bg-white/15 shadow-lg backdrop-blur-md transition-all duration-200 group-hover:scale-105 group-hover:border-white/70 group-hover:bg-white/25">
                    <PlayIcon width={24} height={24} className="ml-0.5 text-white drop-shadow" />
                  </span>
                </span>
                {v.durationLabel ? (
                  <span className="absolute bottom-2 right-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
                    {v.durationLabel}
                  </span>
                ) : null}
              </button>
            ) : (
              <span
                className="flex aspect-video w-full items-center justify-center"
                style={{
                  background:
                    "linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 24%, var(--surface)), var(--surface))",
                }}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-surface/80">
                  <PlayIcon width={22} height={22} className="ml-0.5 text-ink-muted" />
                </span>
              </span>
            )}
            <span className="block px-3 py-2.5">
              <span className="block text-sm font-medium leading-snug text-ink">{v.title}</span>
              {v.description ? (
                <span className="mt-0.5 block truncate text-xs text-ink-muted">{v.description}</span>
              ) : null}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
