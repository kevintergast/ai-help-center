import { getCurrentTenant } from "@/lib/tenant/current";
import { readPageViewer, requireTeamPage } from "@/server/auth/page-guard";
import { AdminShell } from "@/components/admin/admin-shell";

/**
 * Admin-/Betreiber-Bereich. Eigenes Voll-Layout (Seitennavigation), bewusst
 * getrennt von der Endnutzer-Ansicht. Läuft unter dem Root-Layout (Tenant +
 * Theme).
 *
 * GATING (fail-closed): Alle Seiten hierunter lesen echte, tenant-gebundene
 * D1-Inhalte über ALLE Status (inkl. Entwürfe). Deshalb wird der gesamte
 * /admin-Bereich an diesem einen Chokepoint serverseitig abgesichert —
 * `requireTeamPage` spiegelt die API-Guard-Kette (Session → tenant-gebunden →
 * MFA → Rolle ≥ content) und ruft sonst `notFound()`. So kann kein anonymer
 * Besucher unveröffentlichte Inhalte sehen.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  await requireTeamPage(tenant, "content");
  return (
    <AdminShell
      locale={tenant.defaultLocale}
      tenantName={tenant.name}
      logoUrl={tenant.branding.logoUrl}
      logoDarkUrl={tenant.branding.logoDarkUrl ?? null}
      isOperator={tenant.id === "t_operator"}
      viewer={await readPageViewer(tenant)}
    >
      {children}
    </AdminShell>
  );
}
