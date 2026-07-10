"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  "aria-label": string;
  className?: string;
}

/** Barrierefreie Tabs (Roving-Tabindex, Pfeiltasten, aria-selected). */
export function Tabs({ tabs, className, "aria-label": ariaLabel }: TabsProps) {
  const [current, setCurrent] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusTab(i: number) {
    const next = (i + tabs.length) % tabs.length;
    setCurrent(next);
    refs.current[next]?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusTab(i + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusTab(i - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusTab(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusTab(tabs.length - 1);
    }
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex gap-1 border-b border-hairline"
      >
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`${base}-tab-${i}`}
            aria-selected={current === i}
            aria-controls={`${base}-panel-${i}`}
            tabIndex={current === i ? 0 : -1}
            onClick={() => setCurrent(i)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "-mb-px border-b-2 px-3.5 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:shadow-focusglow",
              current === i
                ? "border-brand font-medium text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${i}`}
          aria-labelledby={`${base}-tab-${i}`}
          hidden={current !== i}
          className="pt-5 text-ink"
        >
          {current === i ? t.content : null}
        </div>
      ))}
    </div>
  );
}
