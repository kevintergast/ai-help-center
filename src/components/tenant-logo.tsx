import type { Tenant } from "@/lib/tenant/types";

/**
 * Tenant-Logo als Server-Komponente: wird im SSR-HTML ausgeliefert (kein
 * Client-Fetch fürs erste Paint). `logoUrl` ist bereits fertig abgeleitet
 * (R2-Serving-Route mit ?v=-Cache-Buster ODER externe URL — siehe
 * src/server/tenant/repository.ts). Ohne Logo: Initiale in Brand-Farbe.
 */
export function TenantLogo({ tenant }: { tenant: Tenant }) {
  if (tenant.branding.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Tenant-Logos kommen aus R2/extern; next/image-Optimierung ist im Worker nicht verfügbar.
      <img src={tenant.branding.logoUrl} alt={tenant.name} className="h-7" />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold"
      style={{ background: "var(--brand-primary)", color: "var(--brand-primary-fg)" }}
    >
      {tenant.name.charAt(0)}
    </div>
  );
}
