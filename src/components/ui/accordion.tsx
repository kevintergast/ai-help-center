"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { PlusIcon } from "./icons";

export interface AccordionItem {
  id: string;
  question: ReactNode;
  answer: ReactNode;
}

export interface AccordionProps {
  items: AccordionItem[];
  className?: string;
}

/** FAQ-Accordion (aria-expanded/-controls). Mehrere Einträge dürfen offen sein. */
export function Accordion({ items, className }: AccordionProps) {
  const base = useId();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className={cn("divide-y divide-hairline overflow-hidden rounded-card border border-hairline", className)}>
      {items.map((it) => {
        const isOpen = !!open[it.id];
        return (
          <div key={it.id}>
            <h3>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`${base}-${it.id}`}
                onClick={() => setOpen((s) => ({ ...s, [it.id]: !s[it.id] }))}
                className="flex w-full items-center justify-between gap-4 bg-surface px-5 py-4 text-left text-base font-medium text-ink transition-colors hover:bg-tint focus-visible:outline-none focus-visible:shadow-focusglow"
              >
                {it.question}
                <PlusIcon
                  width={18}
                  height={18}
                  className={cn(
                    "shrink-0 text-ink-muted transition-transform duration-200",
                    isOpen && "rotate-45",
                  )}
                />
              </button>
            </h3>
            <div
              id={`${base}-${it.id}`}
              role="region"
              hidden={!isOpen}
              className="bg-surface px-5 pb-4 text-sm leading-relaxed text-ink-muted"
            >
              {it.answer}
            </div>
          </div>
        );
      })}
    </div>
  );
}
