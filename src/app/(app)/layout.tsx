import { getCurrentTenant } from "@/lib/tenant/current";
import TenantSwitcher from "@/components/tenant-switcher";

/**
 * Layout des Endnutzer-Hilfezentrums (Root `/` und `/<slug>`). Das Tenant-
 * Branding (CSS-Variablen) liegt global auf <html> (Root-Layout). Hier KEINE
 * eigene App-Shell mehr: Hilfezentrum-Übersicht und Artikelseite bringen ihre
 * eigene Kopfzeile/Layout mit (sonst doppelte Chrome). Der Dev-Tenant-Switcher
 * (nur außerhalb von Production) bleibt als Navigationshilfe.
 *
 * WIDGET AUF DER EIGENEN SEITE (0027, opt-in je Instanz): eingebunden wird
 * GENAU das Kunden-Snippet — derselbe Loader, dasselbe iframe. Damit ist der
 * Widget-Pfad dauerhaft dogfooded (bricht das Widget, sehen wir es hier
 * zuerst) und Interessenten erleben auf der Operator-Instanz exakt das, was
 * sie später auf ihrer Website einbauen. Nur öffentliche Seiten: der
 * Admin-Bereich hat sein eigenes Layout ohne Launcher.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  // Unbekannter Host: Root-Layout rendert die Not-Found-Shell; hier nichts.
  if (!tenant) return null;
  return (
    <>
      {children}
      {tenant.widgetOnSite ? <script src="/widget.js" async /> : null}
      <TenantSwitcher />
    </>
  );
}
