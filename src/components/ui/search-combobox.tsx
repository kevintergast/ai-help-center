"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/ui/cn";
import { useClickOutside } from "@/lib/ui/use-click-outside";
import { SearchIcon } from "./icons";

export interface ComboItem {
  id: string;
  title: string;
  category?: string;
}

export interface SearchComboboxProps {
  items: ComboItem[];
  placeholder?: string;
  emptyLabel: string;
  "aria-label": string;
  className?: string;
  onSelect?: (item: ComboItem) => void;
}

/** Suchfeld mit Live-Ergebnissen (Combobox-Pattern). Findet Artikel beim Tippen. */
export function SearchCombobox({
  items,
  placeholder,
  emptyLabel,
  className,
  onSelect,
  "aria-label": ariaLabel,
}: SearchComboboxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  useClickOutside(ref, () => setOpen(false), open);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        (it.category ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  function pick(i: number) {
    const it = results[i];
    if (!it) return;
    setQuery(it.title);
    setOpen(false);
    onSelect?.(it);
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
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <div className="flex items-center gap-2.5 rounded-full border border-hairline bg-surface-raised px-4 py-2.5 focus-within:border-transparent focus-within:shadow-[0_0_0_2px_var(--ring)]">
        <SearchIcon className="shrink-0 text-ink-muted" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
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
          className="w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
        />
      </div>
      {open ? (
        <ul
          role="listbox"
          id={listId}
          aria-label={ariaLabel}
          className="absolute z-50 mt-1.5 max-h-72 w-full overflow-auto rounded-card border border-hairline bg-surface-raised p-1.5 shadow-focusglow"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-ink-muted">{emptyLabel}</li>
          ) : (
            results.map((it, i) => (
              <li
                key={it.id}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-comfy px-3 py-2 text-sm",
                  i === active ? "bg-tint" : "",
                )}
              >
                <span className="text-ink">{it.title}</span>
                {it.category ? (
                  <span className="shrink-0 text-xs text-ink-muted">{it.category}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
