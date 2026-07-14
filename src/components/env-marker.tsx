import type { AppEnv } from "@/lib/env";
import { cn } from "@/lib/ui/cn";

// Technischer Marker (dev-only) — bewusst eigene, theme-unabhängige Farben,
// nicht die Marken-Tokens. Labels sind keine übersetzbare Produkt-UI.
const LABEL: Record<"local" | "development", string> = {
  local: "LOCAL",
  development: "DEVELOPMENT",
};

/**
 * Kleiner, nicht-interaktiver Umgebungs-Marker oben mittig am Bildschirmrand.
 * In `production` wird NICHTS gerendert. `pointer-events-none` → blockiert nie Klicks.
 */
export function EnvMarker({ env }: { env: AppEnv }) {
  if (env === "production") return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center">
      <span
        className={cn(
          "rounded-b-md px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white shadow-sm",
          env === "local" ? "bg-[#4f46e5]" : "bg-[#b45309]",
        )}
      >
        {LABEL[env]}
      </span>
    </div>
  );
}
