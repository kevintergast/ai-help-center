import type { Tenant } from "@/lib/tenant/types";

/**
 * Tenant-Logo als Server-Komponente: wird im SSR-HTML ausgeliefert (kein
 * Client-Fetch fürs erste Paint). `logoUrl` ist bereits fertig abgeleitet
 * (R2-Serving-Route mit ?v=-Cache-Buster ODER externe URL — siehe
 * src/server/tenant/repository.ts). Ohne Logo: Initiale in Brand-Farbe.
 *
 * DARK-MODE-VARIANTE (0023): Ist ein dunkles Logo hinterlegt, wählt der
 * Browser es JS-frei über <picture>/<source media> — das Produkt-Theming
 * hängt ausschließlich an prefers-color-scheme (globals.css), dieselbe
 * Media-Query gilt daher auch hier. Ohne dunkles Logo: helles für beide.
 */
export function TenantLogo({ tenant }: { tenant: Tenant }) {
  const light = tenant.branding.logoUrl;
  const dark = tenant.branding.logoDarkUrl ?? null;
  if (light) {
    // eslint-disable-next-line @next/next/no-img-element -- Tenant-Logos kommen aus R2/extern; next/image-Optimierung ist im Worker nicht verfügbar.
    const img = <img src={light} alt={tenant.name} className="h-7" />;
    if (!dark) return img;
    return (
      <picture>
        <source srcSet={dark} media="(prefers-color-scheme: dark)" />
        {img}
      </picture>
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
