import { getCurrentTenant } from "@/lib/tenant/current";
import { getHelpCenterData } from "@/server/content/runtime";
import { HelpCenter } from "@/components/help-center/help-center";

/**
 * Endnutzer-Startansicht = das Hilfezentrum, direkt unter der Tenant-Root `/`
 * (nicht mehr `/help`). Inhalte (nur veröffentlicht) werden serverseitig aus D1
 * aufgelöst und als fertiges Bundle an die Client-Komponente gereicht; einzelne
 * Artikel haben eigene SSR-URLs unter `/<slug>` (siehe `[slug]/page.tsx`).
 */
export default async function Home() {
  const tenant = await getCurrentTenant();
  // Unbekannter Host: Root-Layout rendert die Not-Found-Shell; hier nichts.
  if (!tenant) return null;
  const data = await getHelpCenterData(tenant);
  return (
    <HelpCenter
      locale={tenant.defaultLocale}
      tenantName={tenant.name}
      logoUrl={tenant.branding.logoUrl}
      data={data}
    />
  );
}
