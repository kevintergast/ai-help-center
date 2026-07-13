import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface MeterProps {
  label: ReactNode;
  /** Anzeigewert, z. B. "25.400 / 25.000". */
  value: ReactNode;
  /** Füllstand 0–100 (wird geklemmt). */
  percent: number;
  /** Warnfarbe (z. B. am/über Limit). */
  warn?: boolean;
  className?: string;
}

/** Fortschritts-/Auslastungsbalken für Credits, MAU, Overage. */
export function Meter({ label, value, percent, warn = false, className }: MeterProps) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-ink">{label}</span>
        <span className="tabular-nums text-ink-muted">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-tint">
        <div
          className={cn("h-full rounded-full", warn ? "bg-warn" : "bg-brand")}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}
