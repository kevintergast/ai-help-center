"use client";

import Link from "next/link";
import { createContext, useContext } from "react";
import type { EntryCard } from "@/lib/content/entry-cards";
import { entryCardHref } from "@/lib/content/entry-cards";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import {
  DocIcon,
  ExternalLinkIcon,
  MegaphoneIcon,
  RoadmapIcon,
} from "@/components/ui/icons";

/**
 * EINSTIEGS-KARTEN unter der KI-Eingabe (Migration 0035).
 *
 * WARUM ES SIE GIBT: Ein leeres Eingabefeld ist für jemanden, der das Produkt
 * noch nicht kennt, keine Einladung, sondern eine Prüfung. Die Karten sind der
 * vom Betreiber gesetzte erste Schritt — dasselbe Muster, das KI-Oberflächen
 * unter ihrem Prompt-Feld anbieten.
 *
 * NAVIGATION: Artikel und Auswärts-Links sind echte `<a>`/`<Link>` (Mittelklick,
 * „in neuem Tab öffnen" und Statusleiste funktionieren). Roadmap und Changelog
 * sind KEINE eigenen Seiten, sondern eine Ebene INNERHALB der Hülle — dafür
 * gibt es den Kontext unten, statt die Ansicht zu einer Route zu machen, die
 * es nicht gibt.
 */

/** Öffnet die Roadmap-/Changelog-Ebene der Hülle (von HelpShell bereitgestellt). */
export const HelpDrillContext = createContext<((which: "roadmap" | "changelog") => void) | null>(
  null,
);

const CARD =
  "group flex h-full flex-col gap-1 rounded-comfy border border-hairline bg-surface p-4 text-left transition-colors hover:border-brand/40 hover:bg-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function EntryCards({ cards, locale }: { cards: EntryCard[]; locale: Locale }) {
  const t = getT(locale);
  const openDrill = useContext(HelpDrillContext);
  if (cards.length === 0) return null;

  return (
    <ul
      aria-label={t("hc.entryCards.heading")}
      className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {cards.map((card) => (
        <li key={card.id}>
          <EntryCardBody card={card} openDrill={openDrill} />
        </li>
      ))}
    </ul>
  );
}

function EntryCardBody({
  card,
  openDrill,
}: {
  card: EntryCard;
  openDrill: ((which: "roadmap" | "changelog") => void) | null;
}) {
  const inner = (
    <>
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        <CardIcon kind={card.kind} />
        <span className="min-w-0 flex-1 truncate">{card.title}</span>
        {card.kind === "url" ? (
          <ExternalLinkIcon width={12} height={12} className="shrink-0 opacity-50" aria-hidden />
        ) : null}
      </span>
      {card.description.length > 0 ? (
        <span className="text-[13px] leading-snug text-ink-muted">{card.description}</span>
      ) : null}
    </>
  );

  const href = entryCardHref(card);

  if (card.kind === "article" && href) {
    return (
      <Link href={href} className={CARD}>
        {inner}
      </Link>
    );
  }

  if (card.kind === "url" && href) {
    // Auswärts: kein Referrer-Leck, kein `window.opener` auf unsere Seite.
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={CARD}>
        {inner}
      </a>
    );
  }

  // Roadmap/Changelog: Ebene in der Hülle. Ohne Kontext (theoretisch) lieber
  // gar kein Klickziel als eines, das nichts tut.
  return (
    <button
      type="button"
      onClick={() => openDrill?.(card.kind === "roadmap" ? "roadmap" : "changelog")}
      disabled={openDrill === null}
      className={`${CARD} w-full disabled:cursor-default disabled:opacity-60`}
    >
      {inner}
    </button>
  );
}

function CardIcon({ kind }: { kind: EntryCard["kind"] }) {
  const props = { width: 15, height: 15, className: "shrink-0 opacity-70" } as const;
  if (kind === "roadmap") return <RoadmapIcon {...props} />;
  if (kind === "changelog") return <MegaphoneIcon {...props} />;
  return <DocIcon {...props} />;
}
