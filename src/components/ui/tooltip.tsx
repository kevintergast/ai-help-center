"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface TooltipProps {
  /** Tooltip-Text (i18n-fähig, vom Aufrufer). */
  label: string;
  children: ReactNode;
  className?: string;
}

/** Zeigt einen Hinweis bei Hover/Fokus. Trigger via aria-describedby verknüpft. */
export function Tooltip({ label, children, className }: TooltipProps) {
  const id = useId();
  return (
    <span className={cn("group relative inline-flex", className)}>
      <span aria-describedby={id} className="inline-flex">
        {children}
      </span>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-comfy bg-[var(--btn-primary-bg)] px-2.5 py-1.5 text-xs text-[var(--btn-primary-fg)] opacity-0 shadow-focusglow transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
