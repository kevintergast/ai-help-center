import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";
import { SearchIcon } from "./icons";

export interface SearchBarProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

/** Zentrale Such-Pille — einladend, nicht klinisch. */
export function SearchBar({ className, ...rest }: SearchBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-full border border-hairline bg-surface-raised px-4 py-2.5",
        "focus-within:border-transparent focus-within:shadow-[0_0_0_2px_var(--ring)]",
        className,
      )}
    >
      <SearchIcon className="shrink-0 text-ink-muted" />
      <input
        type="search"
        className="w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
        {...rest}
      />
    </div>
  );
}
