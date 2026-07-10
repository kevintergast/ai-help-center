import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { WarnIcon } from "./icons";

type Tone = "warn" | "crit" | "ok";

const TONES: Record<Tone, string> = {
  warn: "border-warn-bd bg-warn-bg text-warn",
  crit: "border-crit-bd bg-crit-bg text-crit",
  ok: "border-ok-bd bg-ok-bg text-ok",
};

export interface BannerProps {
  tone?: Tone;
  title: ReactNode;
  description?: ReactNode;
  /** Optionaler Aktions-Slot (z. B. ein Button). */
  action?: ReactNode;
  className?: string;
}

/** Hinweis-/Alarmbanner (z. B. over_limit-Kulanz). */
export function Banner({ tone = "warn", title, description, action, className }: BannerProps) {
  return (
    <div
      className={cn("flex items-start gap-3.5 rounded-card border p-4", TONES[tone], className)}
      role="status"
    >
      <WarnIcon className="mt-0.5 shrink-0" width={20} height={20} />
      <div className="flex-1">
        <strong className="block font-semibold text-ink">{title}</strong>
        {description ? <span className="text-sm text-ink-muted">{description}</span> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
