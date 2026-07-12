import { cn } from "@/lib/ui/cn";

/** Dekorative Mini-Sparkline (Fläche + Linie) in currentColor. */
export function Sparkline({
  values,
  className,
  width = 96,
  height = 28,
}: {
  values: number[];
  className?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - ((v - min) / span) * (height - 4) - 2]);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      aria-hidden
      preserveAspectRatio="none"
    >
      <path d={area} fill="currentColor" opacity={0.12} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Vertikales Balkendiagramm; letzter Balken hervorgehoben. Text via aria-label vom Aufrufer. */
export function BarChart({
  values,
  "aria-label": ariaLabel,
  className,
}: {
  values: number[];
  "aria-label": string;
  className?: string;
}) {
  const max = Math.max(...values, 1);
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn("flex h-40 items-end gap-1.5", className)}
    >
      {values.map((v, i) => {
        const last = i === values.length - 1;
        return (
          <div
            key={i}
            style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
            className={cn(
              "flex-1 rounded-t-[3px] transition-colors",
              last
                ? "bg-brand"
                : "bg-[color-mix(in_srgb,var(--brand-primary)_35%,transparent)]",
            )}
          />
        );
      })}
    </div>
  );
}
