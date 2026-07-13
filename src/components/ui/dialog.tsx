"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { IconButton } from "./icon-button";
import { CloseIcon } from "./icons";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
  /** Optionaler Footer-Slot (z. B. Aktions-Buttons). */
  footer?: ReactNode;
  className?: string;
}

/**
 * Modaler Dialog auf Basis des nativen <dialog> (Fokus-Falle, Esc, ::backdrop
 * kommen vom Browser). Steuerung über `open`/`onClose`.
 */
export function Dialog({ open, onClose, title, closeLabel, children, footer, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className={cn(
        "w-full max-w-md rounded-container border border-hairline bg-surface-raised p-0 text-ink shadow-focusglow backdrop:bg-black/40",
        className,
      )}
    >
      {open ? (
        <div className="p-6">
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-[-0.3px]">{title}</h2>
            <IconButton aria-label={closeLabel} onClick={onClose} className="h-8 w-8 shadow-none">
              <CloseIcon width={16} height={16} />
            </IconButton>
          </div>
          <div className="text-sm leading-relaxed text-ink-muted">{children}</div>
          {footer ? <div className="mt-6 flex justify-end gap-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
