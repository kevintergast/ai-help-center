"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Article } from "@/lib/content/types";
import { searchArticles, type SearchHit, type SearchSegment } from "@/lib/content/search";
import { cn } from "@/lib/ui/cn";
import { useClickOutside } from "@/lib/ui/use-click-outside";
import { SearchIcon, CloseIcon } from "./icons";

export interface SearchComboboxProps {
  /** Vollständige Artikel — die Suche liest auch den KÖRPER, nicht nur Titel. */
  articles: Article[];
  placeholder?: string;
  emptyLabel: string;
  "aria-label": string;
  clearLabel: string;
  className?: string;
  /** Anfangswert — damit die Anfrage beim Öffnen eines Treffers stehen bleibt. */
  initialQuery?: string;
  onSelect?: (hit: SearchHit, query: string) => void;
}

/**
 * SUCHFELD mit Live-Ergebnissen (Combobox-Pattern).
 *
 * Sucht über Titel, Kategorie UND Inhalt (lib/content/search.ts) und zeigt je
 * Treffer einen Ausschnitt mit markierten Fundstellen — damit man VOR dem
 * Klick sieht, warum ein Artikel gefunden wurde. Vorher wurde nur der Titel
 * verglichen; wer sich an eine Formulierung im Artikel erinnerte, fand ihn nicht.
 *
 * LEERE ANFRAGE = KEINE LISTE. Vorher erschienen bei Fokus alle Artikel als
 * „Treffer" — eine Liste, die nichts beantwortet und die echten Ergebnisse
 * später nur verdeckt.
 */
export function SearchCombobox({
  articles,
  placeholder,
  emptyLabel,
  clearLabel,
  className,
  initialQuery = "",
  onSelect,
  "aria-label": ariaLabel,
}: SearchComboboxProps) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  useClickOutside(ref, () => setOpen(false), open);

  const results = useMemo(() => searchArticles(articles, query), [articles, query]);
  const showList = open && query.trim().length > 0;

  function pick(i: number) {
    const hit = results[i];
    if (!hit) return;
    // Anfrage BLEIBT stehen: Im geöffneten Artikel markiert sie die
    // Fundstellen, und wer zurückgeht, muss nicht neu tippen. Nur die Liste
    // schließt sich.
    setOpen(false);
    onSelect?.(hit, query);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query.length > 0) setQuery("");
      else setOpen(false);
    }
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Schlanker als vorher: kleinere Schrift, weniger Polsterung, keine
          angehobene Fläche — die Leiste ist ein Werkzeug, kein Blickfang. */}
      <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1.5 transition-colors focus-within:border-transparent focus-within:shadow-[0_0_0_2px_var(--ring)]">
        <SearchIcon width={15} height={15} className="shrink-0 text-ink-muted" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKey}
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
        {query.length > 0 ? (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="shrink-0 rounded-full p-0.5 text-ink-muted transition-colors hover:text-ink"
          >
            <CloseIcon width={13} height={13} />
          </button>
        ) : null}
      </div>

      {showList ? (
        <ul
          role="listbox"
          id={listId}
          aria-label={ariaLabel}
          // BREITER ALS DAS FELD: In der schmalen Leiste (224px) bricht ein
          // Textausschnitt nach drei Wörtern um und ist nicht mehr überfliegbar.
          // Die Liste schwebt ohnehin — sie darf die Leiste überragen.
          className="absolute z-50 mt-1.5 max-h-[24rem] w-[min(26rem,calc(100vw-2rem))] min-w-full overflow-auto rounded-card border border-hairline bg-surface-raised p-1.5 shadow-focusglow"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-ink-muted">{emptyLabel}</li>
          ) : (
            results.map((hit, i) => (
              <li
                key={hit.id}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={cn(
                  "cursor-pointer rounded-comfy px-3 py-2",
                  i === active ? "bg-tint" : "",
                )}
              >
                <p className="text-sm font-medium text-ink">
                  <Segments parts={hit.titleSegments} />
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">{hit.category}</p>
                {hit.snippet.length > 0 ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-muted">
                    <Segments parts={hit.snippet} />
                  </p>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Markierte Fundstellen. Bewusst über Segmente statt über eingefügtes Markup:
 * Der Suchbegriff kommt vom Nutzer, und HTML daraus zu bauen wäre ein
 * Einfallstor. React setzt Text hier immer als Text.
 */
function Segments({ parts }: { parts: SearchSegment[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-[3px] bg-warn-bg px-0.5 text-ink">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
