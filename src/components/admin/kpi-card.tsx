import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { Sparkline } from "./charts";

/**
 * Kennzahl-Kachel mit Wert, optionalem Trend und Mini-Sparkline (Sparkline
 * blendet sich unter 2 Punkten selbst aus). Server-sicher (keine Hooks).
 * `deltaPct` weglassen, wenn es (noch) keine Vergleichsbasis gibt — dann
 * entfällt die Trendzeile, statt ein fiktives „+0 %" zu zeigen.
 */
export function KpiCard({
  label,
  value,
  deltaPct,
  deltaSuffix,
  spark = [],
}: {
  label: ReactNode;
  value: ReactNode;
  deltaPct?: number;
  deltaSuffix?: ReactNode;
  spark?: number[];
}) {
  const positive = (deltaPct ?? 0) >= 0;
  return (
    <div className="rounded-card border border-hairline bg-surface p-5">
      <p className="text-sm text-ink-muted">{label}</p>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <span className="text-[28px] font-semibold leading-none tracking-[-0.6px] tabular-nums text-ink">
          {value}
        </span>
        <span className="text-brand">
          <Sparkline values={spark} />
        </span>
      </div>
      {deltaPct !== undefined ? (
        <p className="mt-2 text-xs">
          <span className={cn("font-medium tabular-nums", positive ? "text-ok" : "text-crit")}>
            {positive ? "+" : ""}
            {deltaPct}%
          </span>{" "}
          <span className="text-ink-muted">{deltaSuffix}</span>
        </p>
      ) : null}
    </div>
  );
}
