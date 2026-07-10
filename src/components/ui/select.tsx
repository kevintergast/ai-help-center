"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/ui/cn";
import { useClickOutside } from "@/lib/ui/use-click-outside";
import { ChevronDownIcon, CheckIcon } from "./icons";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  "aria-label": string;
  className?: string;
}

/** Barrierefreies Dropdown (Listbox-Pattern: Tastatur, aria-activedescendant, Klick-außerhalb). */
export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState(defaultValue ?? "");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  const current = value ?? internal;
  const selected = options.find((o) => o.value === current);
  useClickOutside(ref, () => setOpen(false), open);

  function choose(i: number) {
    const opt = options[i];
    if (!opt) return;
    if (value === undefined) setInternal(opt.value);
    onValueChange?.(opt.value);
    setOpen(false);
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
        setActive(Math.max(0, options.findIndex((o) => o.value === current)));
      }
      return;
    }
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    }
  }

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        className="flex min-w-[200px] items-center justify-between gap-2 rounded-std border border-hairline bg-surface-raised px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:shadow-focusglow"
      >
        <span className={cn(!selected && "text-ink-muted")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDownIcon
          className={cn("shrink-0 text-ink-muted transition-transform", open && "rotate-180")}
          width={16}
          height={16}
        />
      </button>
      {open ? (
        <ul
          role="listbox"
          id={listId}
          aria-label={ariaLabel}
          className="absolute z-50 mt-1 max-h-64 w-full min-w-[200px] overflow-auto rounded-comfy border border-hairline bg-surface-raised p-1 shadow-focusglow"
        >
          {options.map((o, i) => {
            const isSelected = o.value === current;
            return (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={cn(
                  "flex cursor-pointer items-center justify-between rounded-micro px-2.5 py-1.5 text-sm text-ink",
                  i === active && "bg-tint",
                )}
              >
                {o.label}
                {isSelected ? <CheckIcon width={15} height={15} className="text-brand" /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
