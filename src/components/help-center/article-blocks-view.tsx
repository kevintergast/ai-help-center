import Link from "next/link";
import type { ArticleBlock, ArticleLinkCard } from "@/lib/content/blocks";
import { textToParagraphs } from "@/lib/content/headings";
import { formatFileSize } from "@/lib/content/file-size";
import type { ArticleFile, ArticleImage, ArticleVideo } from "@/lib/content/types";
import type { Locale } from "@/lib/tenant/types";
import { Badge } from "@/components/ui/badge";
import { ChevronRightIcon, DownloadIcon, ExternalLinkIcon } from "@/components/ui/icons";
import { ArticleVideos } from "./article-videos";
import { RichTextView } from "./rich-text-view";

/**
 * ÖFFENTLICHER Block-Renderer (Block-Editor-Umbau): rendert die geordnete
 * Blockliste eines Artikels. Sicherheit: alle Texte sind React-escaped
 * (RichTextView erlaubt nur das Markdown-Subset, Links nur http/https);
 * Tag-/Flag-Farben kommen aus der festen Palette (Badge-Töne, kein CSS aus
 * Nutzerdaten). Bild-/Video-Blöcke referenzieren ANHÄNGE — fehlende oder
 * vorgemerkte (pending) Referenzen werden still übersprungen.
 *
 * `SingleBlockView` ist DIE eine Darstellung eines Blocks — der WYSIWYG-
 * Editor rendert damit identisch zur veröffentlichten Seite (Wiedererkennung).
 */

const CALLOUT_STYLES: Record<"info" | "warning" | "error", string> = {
  info: "border-[color-mix(in_srgb,var(--brand-primary)_32%,transparent)] bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)]",
  warning: "border-warn-bd bg-warn-bg",
  error: "border-crit-bd bg-crit-bg",
};

export interface BlockViewContext {
  images: ArticleImage[];
  videos: ArticleVideo[];
  files?: ArticleFile[];
  videoPlayLabel: string;
  /** Label des Download-Blocks (i18n kommt von der Server-Seite). */
  fileDownloadLabel?: string;
  /** Datei-URL-Bau (public Route bzw. team-gegatete Admin-Route im Editor). */
  fileSrcFor?: (fileId: string) => string;
  /** Locale für Zahlenformate (Dateigrößen). */
  locale?: string;
  /** Bild-URL-Bau (public Route bzw. team-gegatete Admin-Route im Editor). */
  srcFor: (imageId: string) => string;
  /** Überschriften-Anker („Abschnitt teilen") — nur öffentlich, nicht im Editor. */
  anchors?: { locale: Locale; taken: Set<string> };
  /**
   * `false` = Artikel-Link-Cards rendern als NICHT-klickbare Attrappe.
   * Der Editor setzt das: ein Klick würde client-seitig wegnavigieren und
   * den ungespeicherten Entwurf verlieren (Live-Fund 2026-08-22).
   */
  linksActive?: boolean;
}

/** Genau EIN Block, exakt wie im veröffentlichten Artikel. `null` = nichts zu zeigen. */
export function SingleBlockView({ block, ctx }: { block: ArticleBlock; ctx: BlockViewContext }) {
  if (block.type === "text") {
    if (block.variant === "code") {
      return (
        <pre className="overflow-x-auto rounded-comfy border border-hairline bg-surface-raised px-4 py-3 font-mono text-[13px] leading-relaxed text-ink">
          <code>{block.text}</code>
        </pre>
      );
    }
    if (block.variant === "standard") {
      return (
        <div className="flex flex-col gap-4">
          <RichTextView body={textToParagraphs(block.text)} anchors={ctx.anchors} />
        </div>
      );
    }
    return (
      <div className={`flex flex-col gap-4 rounded-comfy border px-4 py-3 ${CALLOUT_STYLES[block.variant]}`}>
        <RichTextView body={textToParagraphs(block.text)} anchors={ctx.anchors} />
      </div>
    );
  }

  if (block.type === "image") {
    const img = ctx.images.find((im) => im.id === block.imageId && !im.pending);
    if (!img) return null;
    return (
      <figure>
        {/* Beschreibung = Alt-Text (Architektur-Pflicht, a11y). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ctx.srcFor(img.id)}
          alt={img.description}
          loading="lazy"
          className="w-full rounded-comfy border border-hairline bg-surface"
        />
        <figcaption className="mt-1.5 text-xs text-ink-muted">{img.description}</figcaption>
      </figure>
    );
  }

  if (block.type === "video") {
    const video = ctx.videos.find((v) => v.id === block.videoId);
    if (!video) return null;
    return <ArticleVideos videos={[video]} playLabel={ctx.videoPlayLabel} />;
  }

  if (block.type === "table") {
    const cols = Math.max(block.head.length, ...block.rows.map((r) => r.length), 1);
    return (
      // Breite Tabellen scrollen im eigenen Container (nie die Seite).
      <div className="overflow-x-auto rounded-comfy border border-hairline">
        <table className="w-full border-collapse text-sm">
          {block.head.length > 0 ? (
            <thead>
              <tr className="border-b border-hairline bg-tint text-left">
                {Array.from({ length: cols }, (_, i) => (
                  <th key={i} className="px-3 py-2 font-medium text-ink">
                    {block.head[i] ?? ""}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri} className="border-b border-hairline last:border-b-0">
                {Array.from({ length: cols }, (_, ci) => (
                  <td key={ci} className="px-3 py-2 align-top text-ink-muted">
                    {row[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === "accordion") {
    return (
      // <details> = natives Auf-/Zuklappen, ohne JavaScript und ohne State —
      // funktioniert server-gerendert, im Ausdruck und mit Screenreadern.
      <details className="group/acc rounded-comfy border border-hairline bg-surface open:bg-tint/40">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium text-ink marker:content-none hover:text-brand [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon
            width={16}
            height={16}
            className="shrink-0 text-ink-muted transition-transform group-open/acc:rotate-90"
            aria-hidden
          />
          {block.title}
        </summary>
        <div className="flex flex-col gap-4 border-t border-hairline px-4 py-3">
          <RichTextView body={textToParagraphs(block.text)} anchors={ctx.anchors} />
        </div>
      </details>
    );
  }

  if (block.type === "divider") {
    return <hr className="my-2 border-0 border-t border-hairline" />;
  }

  if (block.type === "button") {
    const external = /^https?:\/\//i.test(block.href);
    const cls =
      "inline-flex w-fit items-center gap-2 rounded-std bg-brand px-4 py-2.5 text-sm font-medium text-brand-fg transition-opacity hover:opacity-90";
    // Im Editor NICHT klickbar (wie die Cards) — kein Wegnavigieren mit
    // ungespeichertem Entwurf.
    if (ctx.linksActive === false) {
      return (
        <span className={cls}>
          {block.label}
          {external ? <ExternalLinkIcon width={14} height={14} aria-hidden /> : null}
        </span>
      );
    }
    return external ? (
      <a href={block.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {block.label}
        <ExternalLinkIcon width={14} height={14} aria-hidden />
      </a>
    ) : (
      <Link href={block.href} className={cls}>
        {block.label}
      </Link>
    );
  }

  if (block.type === "file") {
    const file = ctx.files?.find((f) => f.id === block.fileId);
    if (!file || !ctx.fileSrcFor) return null;
    const meta = formatFileSize(file.size, ctx.locale ?? "de");
    const cls =
      "group flex items-center gap-3 rounded-comfy border border-hairline bg-surface px-4 py-3 transition-colors hover:border-hairline-strong hover:bg-tint";
    const inner = (
      <>
        <DownloadIcon width={18} height={18} className="shrink-0 text-ink-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink group-hover:text-brand">
            {file.name}
          </span>
          <span className="mt-0.5 block text-xs text-ink-muted">{meta}</span>
        </span>
        {ctx.fileDownloadLabel ? (
          <span className="shrink-0 text-xs text-ink-muted">{ctx.fileDownloadLabel}</span>
        ) : null}
      </>
    );
    if (ctx.linksActive === false) return <span className={cls}>{inner}</span>;
    return (
      <a href={ctx.fileSrcFor(file.id)} className={cls} download={file.name}>
        {inner}
      </a>
    );
  }

  if (block.type === "articleLinks") {
    // Kachel-Navigation: zwei Spalten ab sm, eine auf dem Handy. Die Karten
    // sind dieselben wie bei articleLink — nur nebeneinander.
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {block.items.map((card, i) => (
          <LinkCard key={`${card.slug}-${i}`} card={card} linksActive={ctx.linksActive} />
        ))}
      </div>
    );
  }

  if (block.type !== "articleLink") return null;
  return <LinkCard card={block} linksActive={ctx.linksActive} />;
}

/** Verweis-Karte — identisch für Einzelkarte und Gitter. */
function LinkCard({ card, linksActive }: { card: ArticleLinkCard; linksActive?: boolean }) {
  const cardClass =
    "group flex h-full items-start gap-3 rounded-comfy border border-hairline bg-surface px-4 py-3 transition-colors hover:border-hairline-strong hover:bg-tint";
  const cardInner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-ink group-hover:text-brand">{card.title}</span>
        {card.description.length > 0 ? (
          <span className="mt-0.5 block text-sm text-ink-muted">{card.description}</span>
        ) : null}
      </span>
      {card.tag ? (
        <Badge tone={card.tag.color} className="shrink-0">
          {card.tag.text}
        </Badge>
      ) : null}
    </>
  );
  // Im Editor bewusst KEIN Link (s. linksActive) — gleiche Optik, kein Wegklicken.
  if (linksActive === false) return <span className={cardClass}>{cardInner}</span>;
  return (
    <Link href={`/${card.slug}`} className={cardClass}>
      {cardInner}
    </Link>
  );
}

export function ArticleBlocksView({
  blocks,
  images,
  videos,
  files = [],
  articleSlug,
  videoPlayLabel,
  fileDownloadLabel,
  imageSrc,
  fileSrc,
  linksActive,
  anchorLocale,
  locale,
}: {
  blocks: ArticleBlock[];
  images: ArticleImage[];
  videos: ArticleVideo[];
  files?: ArticleFile[];
  articleSlug: string;
  /** i18n-Label des Video-Players (kommt von der Server-Seite). */
  videoPlayLabel: string;
  /** Bild-URL-Bau — Default: public Route; der Admin-Editor injiziert die
   *  team-gegatete Route (zeigt auch Draft-Bilder). */
  imageSrc?: (imageId: string) => string;
  /** Label am Download-Block (i18n). */
  fileDownloadLabel?: string;
  /** Datei-URL-Bau — Default: public Route (wie imageSrc). */
  fileSrc?: (fileId: string) => string;
  /** Locale für Zahlenformate (Dateigrößen); Default de. */
  locale?: string;
  /** `false` im Editor: Cards sind nicht klickbar (kein Entwurfs-Verlust). */
  linksActive?: boolean;
  /** Locale für die Anker-Buttons; fehlt = keine Anker (Editor-Vorschau). */
  anchorLocale?: Locale;
}) {
  const ctx: BlockViewContext = {
    images,
    videos,
    files,
    videoPlayLabel,
    fileDownloadLabel,
    locale,
    srcFor: imageSrc ?? ((id: string) => `/api/v1/content/images/${articleSlug}/${id}`),
    fileSrcFor: fileSrc ?? ((id: string) => `/api/v1/content/files/${articleSlug}/${id}`),
    linksActive,
    // Ein gemeinsames Set über ALLE Blöcke → artikelweit eindeutige Anker.
    anchors: anchorLocale ? { locale: anchorLocale, taken: new Set<string>() } : undefined,
  };
  return (
    <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-ink">
      {blocks.map((block, i) => (
        <SingleBlockView key={i} block={block} ctx={ctx} />
      ))}
    </div>
  );
}

/** Ids der in Blöcken referenzierten Anhänge (Rest rendert die Seite unten). */
export function referencedIds(blocks: ArticleBlock[]): {
  images: Set<string>;
  videos: Set<string>;
  files: Set<string>;
} {
  const images = new Set<string>();
  const videos = new Set<string>();
  const files = new Set<string>();
  for (const b of blocks) {
    if (b.type === "image") images.add(b.imageId);
    else if (b.type === "video") videos.add(b.videoId);
    else if (b.type === "file") files.add(b.fileId);
  }
  return { images, videos, files };
}
