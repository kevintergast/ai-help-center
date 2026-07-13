import { getCurrentTenant } from "@/lib/tenant/current";
import { AppShell } from "@/components/app-shell";
import TenantSwitcher from "@/components/tenant-switcher";

/**
 * Layout der eigentlichen Hilfezentrums-App: rendert die App-Shell (Header mit
 * serverseitig gerendertem Tenant-Logo). Das Tenant-Branding (CSS-Variablen)
 * liegt global auf <html> (Root-Layout) — hier KEIN zweiter Wrapper mehr,
 * damit es nur eine Quelle gibt. Interne Seiten außerhalb dieser Gruppe
 * (z. B. /brandbook) bekommen die Shell bewusst nicht.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  // Unbekannter Host: Root-Layout rendert die Not-Found-Shell; hier nichts.
  if (!tenant) return null;
  return (
    <>
      <AppShell tenant={tenant}>{children}</AppShell>
      <TenantSwitcher />
    </>
  );
}
