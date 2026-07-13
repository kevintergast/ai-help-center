"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { CheckCircleIcon, CloseIcon } from "./icons";

export interface ToastProps {
  open: boolean;
  message: ReactNode;
  onClose: () => void;
  closeLabel: string;
  className?: string;
}

/** Kurze Bestätigungsmeldung, fixiert unten rechts. Auto-Dismiss steuert der Aufrufer. */
export function Toast({ open, message, onClose, closeLabel, className }: ToastProps) {
  if (!open) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-5 right-5 z-[60] flex items-center gap-3 rounded-card border border-hairline bg-surface-raised px-4 py-3 text-sm text-ink shadow-focusglow",
        className,
      )}
    >
      <CheckCircleIcon width={18} height={18} className="shrink-0 text-ok" />
      <span>{message}</span>
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="ml-1 text-ink-muted hover:text-ink focus-visible:outline-none"
      >
        <CloseIcon width={15} height={15} />
      </button>
    </div>
  );
}
