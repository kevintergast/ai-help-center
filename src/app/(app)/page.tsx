import { getCurrentTenant } from "@/lib/tenant/current";
import { readPageViewer } from "@/server/auth/page-guard";
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
  // Viewer = reine Anzeige (Konto-Popup); Inhalte bleiben davon unabhängig.
  const [data, viewer] = await Promise.all([getHelpCenterData(tenant), readPageViewer(tenant)]);
  return (
    <HelpCenter
      locale={tenant.defaultLocale}
      tenantName={tenant.name}
      logoUrl={tenant.branding.logoUrl}
      logoDarkUrl={tenant.branding.logoDarkUrl ?? null}
      data={data}
      isOperator={tenant.id === "t_operator"}
      viewer={viewer}
    />
  );
}
