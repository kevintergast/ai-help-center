"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { ThumbsUpIcon, ThumbsDownIcon, CheckIcon } from "./icons";

export interface FeedbackBarLabels {
  question: ReactNode;
  yes: string;
  no: string;
  thanks: ReactNode;
}

export interface FeedbackBarProps {
  labels: FeedbackBarLabels;
  onVote?: (vote: "up" | "down") => void;
  className?: string;
}

/** „War das hilfreich?" — Daumen hoch/runter, danach Dankeschön-Zustand. */
export function FeedbackBar({ labels, onVote, className }: FeedbackBarProps) {
  const [voted, setVoted] = useState<"up" | "down" | null>(null);

  function vote(v: "up" | "down") {
    setVoted(v);
    onVote?.(v);
  }

  if (voted) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-ok-bd bg-ok-bg px-3.5 py-2 text-sm text-ok",
          className,
        )}
        role="status"
      >
        <CheckIcon width={16} height={16} />
        {labels.thanks}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <span className="text-sm text-ink-muted">{labels.question}</span>
      <div className="flex gap-2">
        <button
          type="button"
          aria-label={labels.yes}
          onClick={() => vote("up")}
          className="grid h-9 w-9 place-items-center rounded-full border border-hairline bg-surface text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink focus-visible:outline-none focus-visible:shadow-focusglow"
        >
          <ThumbsUpIcon width={16} height={16} />
        </button>
        <button
          type="button"
          aria-label={labels.no}
          onClick={() => vote("down")}
          className="grid h-9 w-9 place-items-center rounded-full border border-hairline bg-surface text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink focus-visible:outline-none focus-visible:shadow-focusglow"
        >
          <ThumbsDownIcon width={16} height={16} />
        </button>
      </div>
    </div>
  );
}
