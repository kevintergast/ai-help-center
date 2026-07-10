import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

type Tone = "neutral" | "ok" | "warn" | "crit" | "brand";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface text-ink border-hairline",
  ok: "bg-ok-bg text-ok border-ok-bd",
  warn: "bg-warn-bg text-warn border-warn-bd",
  crit: "bg-crit-bg text-crit border-crit-bd",
  brand:
    "text-brand border-[color-mix(in_srgb,var(--brand-primary)_32%,transparent)] bg-[color-mix(in_srgb,var(--brand-primary)_9%,transparent)]",
};

export interface BadgeProps {
  tone?: Tone;
  /** Statuspunkt in der aktuellen Farbe voranstellen. */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = "neutral", dot = false, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] leading-none",
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
