import { getCurrentTenant } from "@/lib/tenant/current";
import { HelpCenter } from "@/components/help-center/help-center";

/**
 * Endnutzer-Startansicht des Hilfezentrums (KI-First). Läuft unter dem
 * Root-Layout (Tenant-Branding + Theme), bewusst OHNE die Admin-App-Shell —
 * die Ansicht bringt ihr eigenes Voll-Layout (Sidebar + fixe KI-Leiste) mit.
 *
 * Daten kommen heute aus einem getippten Fake (src/lib/content/fake-repo.ts);
 * der Tausch gegen `/api/v1/articles` + `/ask` ist ein Einzeiler im Client.
 */
export default async function HelpPage() {
  const tenant = await getCurrentTenant();
  // Unbekannter Host: Root-Layout rendert die Not-Found-Shell; hier nichts.
  if (!tenant) return null;
  return (
    <HelpCenter
      locale={tenant.defaultLocale}
      tenantName={tenant.name}
      logoUrl={tenant.branding.logoUrl}
    />
  );
}
