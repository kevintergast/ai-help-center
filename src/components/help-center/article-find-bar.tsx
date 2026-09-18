"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { findRanges, terms } from "@/lib/content/search";
import { ArrowLeftIcon, CloseIcon, SearchIcon } from "@/components/ui/icons";

/**
 * FUNDSTELLEN IM ARTIKEL (`?q=`).
 *
 * Wer aus der Suche kommt, will das Wort im Artikel WIEDERFINDEN — sonst
 * beginnt die Suche beim Öffnen von vorn. Diese Leiste markiert alle
 * Vorkommen und springt sie der Reihe nach an.
 *
 * WARUM IM DOM statt im Renderer: Der Artikelkörper besteht aus getypten
 * Blöcken mit Links, Tabellen, Aufklappern. Die Markierung in den Renderer zu
 * ziehen hieße, jeden Blocktyp anzufassen und dabei die Formatierung zu
 * gefährden. Ein Durchlauf über die TEXTKNOTEN danach kommt ohne das aus —
 * dasselbe Vorgehen wie die Suchfunktion des Browsers.
 *
 * NUR TEXTKNOTEN werden angefasst, und die Markierung ist ein `<mark>`-Element
 * um vorhandenen Text. Es wird nie HTML aus der Anfrage gebaut: Der Suchbegriff
 * kommt vom Nutzer.
 */

const MARK = "hoh-find";
const CURRENT = "hoh-find-current";

export function ArticleFindBar({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);

  /** Alle Markierungen entfernen und die zerschnittenen Textknoten wieder zusammenfügen. */
  const clearMarks = useCallback(() => {
    for (const el of Array.from(document.querySelectorAll(`mark.${MARK}`))) {
      const parent = el.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(el.textContent ?? ""), el);
      parent.normalize();
    }
  }, []);

  useEffect(() => {
    clearMarks();
    setIndex(0);

    const words = terms(query);
    if (words.length === 0) {
      setCount(0);
      return;
    }

    let hits = 0;
    for (const block of Array.from(document.querySelectorAll("[data-block]"))) {
      // Erst einsammeln, dann ersetzen: Wer während des Laufs den Baum
      // verändert, bringt den TreeWalker durcheinander.
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      let node = walker.nextNode();
      while (node) {
        if ((node.textContent ?? "").trim().length > 0) texts.push(node as Text);
        node = walker.nextNode();
      }

      for (const text of texts) {
        const value = text.textContent ?? "";
        const ranges = findRanges(value, words);
        if (ranges.length === 0) continue;

        const frag = document.createDocumentFragment();
        let cursor = 0;
        for (const [start, end] of ranges) {
          if (start > cursor) frag.appendChild(document.createTextNode(value.slice(cursor, start)));
          const mark = document.createElement("mark");
          mark.className = MARK;
          mark.textContent = value.slice(start, end);
          frag.appendChild(mark);
          cursor = end;
          hits += 1;
        }
        if (cursor < value.length) frag.appendChild(document.createTextNode(value.slice(cursor)));
        text.parentNode?.replaceChild(frag, text);
      }
    }
    setCount(hits);

    return clearMarks;
  }, [query, clearMarks]);

  /** Die aktuelle Stelle hervorheben und ins Bild holen. */
  useEffect(() => {
    const marks = Array.from(document.querySelectorAll(`mark.${MARK}`));
    marks.forEach((m, i) => m.classList.toggle(CURRENT, i === index));
    marks[index]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [index, count]);

  if (query.trim().length === 0 || count === 0) return null;

  const step = (delta: number) => setIndex((i) => (i + delta + count) % count);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-24">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-hairline bg-surface-raised px-2 py-1.5 shadow-focusglow">
        <SearchIcon width={14} height={14} className="ml-1 shrink-0 text-ink-muted" aria-hidden />
        <span className="max-w-[10rem] truncate px-1 text-sm text-ink">{query}</span>
        <span className="px-1 text-xs tabular-nums text-ink-muted" aria-live="polite">
          {t("hc.find.position", { current: index + 1, total: count })}
        </span>
        <button
          type="button"
          aria-label={t("hc.find.previous")}
          onClick={() => step(-1)}
          className="grid h-7 w-7 place-items-center rounded-full text-ink-muted transition-colors hover:bg-tint hover:text-ink"
        >
          <ArrowLeftIcon width={15} height={15} className="rotate-90" />
        </button>
        <button
          type="button"
          aria-label={t("hc.find.next")}
          onClick={() => step(1)}
          className="grid h-7 w-7 place-items-center rounded-full text-ink-muted transition-colors hover:bg-tint hover:text-ink"
        >
          <ArrowLeftIcon width={15} height={15} className="-rotate-90" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-hairline" aria-hidden />
        <button
          type="button"
          aria-label={t("hc.find.close")}
          onClick={() => {
            clearMarks();
            router.replace(pathname);
          }}
          className="grid h-7 w-7 place-items-center rounded-full text-ink-muted transition-colors hover:bg-tint hover:text-ink"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>
    </div>
  );
}
