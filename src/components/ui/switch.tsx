"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  "aria-label"?: string;
  className?: string;
}

/** Barrierefreier Umschalter (role=switch, aria-checked, Tastatur). */
export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  label,
  className,
  "aria-label": ariaLabel,
}: SwitchProps) {
  const [internal, setInternal] = useState(defaultChecked);
  const id = useId();
  const on = checked ?? internal;

  function toggle() {
    const next = !on;
    if (checked === undefined) setInternal(next);
    onCheckedChange?.(next);
  }

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={ariaLabel}
        aria-labelledby={label ? id : undefined}
        onClick={toggle}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:shadow-focusglow",
          on ? "bg-brand" : "bg-hairline-strong",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-surface-raised shadow-sm transition-transform",
            on ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
      {label ? (
        <span id={id} className="text-sm text-ink">
          {label}
        </span>
      ) : null}
    </span>
  );
}
