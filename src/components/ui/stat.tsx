import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface StatProps {
  value: ReactNode;
  label: ReactNode;
  className?: string;
}

/** Große Kennzahl mit Beschriftung darunter. */
export function Stat({ value, label, className }: StatProps) {
  return (
    <div className={className}>
      <div className="text-[48px] font-semibold leading-none tracking-[-1.2px] text-ink">
        {value}
      </div>
      <div className="mt-2 text-[15px] text-ink-muted">{label}</div>
    </div>
  );
}

export function StatRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-wrap gap-12", className)}>{children}</div>;
}
