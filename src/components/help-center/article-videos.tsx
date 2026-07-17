"use client";

import { useState } from "react";
import type { ArticleVideo } from "@/lib/content/types";
import { PlayIcon } from "@/components/ui/icons";

/**
 * VIDEO-SPALTE der Artikelseite (Architektur: rechte Spalte, Thumbnails,
 * Klick→Abspielen; auf Mobile unter dem Text — das Layout liefert die Seite).
 *
 * KLICK-ZUM-LADEN: Bis zum Klick wird nur das YouTube-Vorschaubild geladen;
 * der Player (iframe) kommt erst danach — und dann über die
 * youtube-NOCOOKIE-Domain (privacy-enhanced Mode). Videos ohne youtubeId
 * (Altbestand) rendern als nicht-klickbare Karte wie bisher.
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
                className="group relative block w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`}
                  alt={v.description}
                  loading="lazy"
                  className="aspect-video w-full object-cover"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/35">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface/95 shadow-md">
                    <PlayIcon width={22} height={22} className="ml-0.5 text-ink" />
                  </span>
                </span>
              </button>
            ) : (
              <span
                className="flex h-28 items-center justify-center"
                style={{
                  background:
                    "linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 24%, var(--surface)), var(--surface))",
                }}
              >
                <PlayIcon width={30} height={30} className="text-ink opacity-80" />
              </span>
            )}
            <span className="flex items-center justify-between gap-2 px-3 py-2.5">
              <span className="text-sm font-medium text-ink">{v.title}</span>
              {v.durationLabel ? (
                <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                  {v.durationLabel}
                </span>
              ) : null}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
