import { getCurrentTenant } from "@/lib/tenant/current";
import TenantSwitcher from "@/components/tenant-switcher";

/**
 * Layout des Endnutzer-Hilfezentrums (Root `/` und `/<slug>`). Das Tenant-
 * Branding (CSS-Variablen) liegt global auf <html> (Root-Layout). Hier KEINE
 * eigene App-Shell mehr: Hilfezentrum-Übersicht und Artikelseite bringen ihre
 * eigene Kopfzeile/Layout mit (sonst doppelte Chrome). Der Dev-Tenant-Switcher
 * (nur außerhalb von Production) bleibt als Navigationshilfe.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  // Unbekannter Host: Root-Layout rendert die Not-Found-Shell; hier nichts.
  if (!tenant) return null;
  return (
    <>
      {children}
      <TenantSwitcher />
    </>
  );
}
