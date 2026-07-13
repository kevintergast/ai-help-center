import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Pflicht: Barrierefreie Beschriftung (kommt vom Aufrufer, i18n-fähig). */
  "aria-label": string;
  children: ReactNode;
}

/** Runder Icon-Button (Pill) mit Inset-Schatten. */
export function IconButton({ className, children, ...rest }: IconButtonProps) {
  return (
    <button
      className={cn(
        "grid h-10 w-10 place-items-center rounded-full bg-surface text-ink shadow-inset",
        "opacity-70 transition-opacity duration-150 hover:opacity-100",
        "focus-visible:outline-none focus-visible:shadow-focusglow",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
