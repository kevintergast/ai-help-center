import Link from "next/link";
import type { ArticleBlock } from "@/lib/content/blocks";
import type { ArticleImage, ArticleVideo } from "@/lib/content/types";
import { Badge } from "@/components/ui/badge";
import { ArticleVideos } from "./article-videos";
import { RichTextView } from "./rich-text-view";

/**
 * ÖFFENTLICHER Block-Renderer (Block-Editor-Umbau): rendert die geordnete
 * Blockliste eines Artikels. Sicherheit: alle Texte sind React-escaped
 * (RichTextView erlaubt nur das Markdown-Subset, Links nur http/https);
 * Tag-/Flag-Farben kommen aus der festen Palette (Badge-Töne, kein CSS aus
 * Nutzerdaten). Bild-/Video-Blöcke referenzieren ANHÄNGE — fehlende oder
 * vorgemerkte (pending) Referenzen werden still übersprungen.
 */

const CALLOUT_STYLES: Record<"info" | "warning" | "error", string> = {
  info: "border-[color-mix(in_srgb,var(--brand-primary)_32%,transparent)] bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)]",
  warning: "border-warn-bd bg-warn-bg",
  error: "border-crit-bd bg-crit-bg",
};

/** Ein Text-Block kann mehrere Markdown-Absätze enthalten (\n\n-getrennt). */
const toParagraphs = (text: string): string[] =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

export function ArticleBlocksView({
  blocks,
  images,
  videos,
  articleSlug,
  videoPlayLabel,
  imageSrc,
}: {
  blocks: ArticleBlock[];
  images: ArticleImage[];
  videos: ArticleVideo[];
  articleSlug: string;
  /** i18n-Label des Video-Players (kommt von der Server-Seite). */
  videoPlayLabel: string;
  /** Bild-URL-Bau — Default: public Route; der Admin-Editor injiziert die
   *  team-gegatete Route (zeigt auch Draft-Bilder). */
  imageSrc?: (imageId: string) => string;
}) {
  const srcFor = imageSrc ?? ((id: string) => `/api/v1/content/images/${articleSlug}/${id}`);
  return (
    <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-ink">
      {blocks.map((block, i) => {
        if (block.type === "text") {
          if (block.variant === "code") {
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-comfy border border-hairline bg-surface-raised px-4 py-3 font-mono text-[13px] leading-relaxed text-ink"
              >
                <code>{block.text}</code>
              </pre>
            );
          }
          if (block.variant === "standard") {
            return <RichTextView key={i} body={toParagraphs(block.text)} />;
          }
          return (
            <div key={i} className={`rounded-comfy border px-4 py-3 ${CALLOUT_STYLES[block.variant]}`}>
              <RichTextView body={toParagraphs(block.text)} />
            </div>
          );
        }

        if (block.type === "image") {
          const img = images.find((im) => im.id === block.imageId && !im.pending);
          if (!img) return null;
          return (
            <figure key={i}>
              {/* Beschreibung = Alt-Text (Architektur-Pflicht, a11y). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={srcFor(img.id)}
                alt={img.description}
                loading="lazy"
                className="w-full rounded-comfy border border-hairline bg-surface"
              />
              <figcaption className="mt-1.5 text-xs text-ink-muted">{img.description}</figcaption>
            </figure>
          );
        }

        if (block.type === "video") {
          const video = videos.find((v) => v.id === block.videoId);
          if (!video) return null;
          return <ArticleVideos key={i} videos={[video]} playLabel={videoPlayLabel} />;
        }

        // articleLink — Card mit eigenem Titel/Beschreibung + Tag-Badge.
        return (
          <Link
            key={i}
            href={`/${block.slug}`}
            className="group flex items-start gap-3 rounded-comfy border border-hairline bg-surface px-4 py-3 transition-colors hover:border-hairline-strong hover:bg-tint"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-ink group-hover:text-brand">
                {block.title}
              </span>
              {block.description.length > 0 ? (
                <span className="mt-0.5 block text-sm text-ink-muted">{block.description}</span>
              ) : null}
            </span>
            {block.tag ? (
              <Badge tone={block.tag.color} className="shrink-0">
                {block.tag.text}
              </Badge>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

/** Ids der in Blöcken referenzierten Anhänge (Rest rendert die Seite unten). */
export function referencedIds(blocks: ArticleBlock[]): {
  images: Set<string>;
  videos: Set<string>;
} {
  const images = new Set<string>();
  const videos = new Set<string>();
  for (const b of blocks) {
    if (b.type === "image") images.add(b.imageId);
    else if (b.type === "video") videos.add(b.videoId);
  }
  return { images, videos };
}
