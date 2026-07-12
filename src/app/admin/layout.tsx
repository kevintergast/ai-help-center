import { getCurrentTenant } from "@/lib/tenant/current";
import { AdminShell } from "@/components/admin/admin-shell";

/**
 * Admin-/Betreiber-Bereich. Eigenes Voll-Layout (Seitennavigation), bewusst
 * getrennt von der Endnutzer-Ansicht. Läuft unter dem Root-Layout (Tenant +
 * Theme). Inhalte sind heute Fakes (src/lib/admin/fake-admin.ts).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  return (
    <AdminShell
      locale={tenant.defaultLocale}
      tenantName={tenant.name}
      logoUrl={tenant.branding.logoUrl}
    >
      {children}
    </AdminShell>
  );
}
