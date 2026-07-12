import { getCurrentTenant } from "@/lib/tenant/current";
import { getHelpCenterData } from "@/server/content/runtime";
import { HelpCenter } from "@/components/help-center/help-center";

/**
 * Endnutzer-Startansicht des Hilfezentrums (KI-First). Läuft unter dem
 * Root-Layout (Tenant-Branding + Theme), bewusst OHNE die Admin-App-Shell —
 * die Ansicht bringt ihr eigenes Voll-Layout (Sidebar + fixe KI-Leiste) mit.
 *
 * Die (nur veröffentlichten) Inhalte werden SERVERSEITIG aus D1 aufgelöst
 * (getHelpCenterData; Fallback: Sample-Daten ohne CF-Kontext) und als fertiges
 * Lese-Bundle an die Client-Komponente gereicht — diese macht keine eigenen
 * Repo-Aufrufe mehr. `ask()`/RAG bleibt ein clientseitiger Stub (Punkt 3).
 */
export default async function HelpPage() {
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
