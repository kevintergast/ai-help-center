import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { readPageViewer } from "@/server/auth/page-guard";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { Card } from "@/components/ui/card";
import { TeamManager } from "@/components/admin/team-manager";

/**
 * TEAM & ROLLEN. Die Einladungs- und Mitglieder-APIs gab es schon lange
 * (api/team.ts) — es fehlte nur die Fläche, über die ein Mensch sie erreicht.
 *
 * Das Admin-Layout gated auf `content`; die Routen dahinter verlangen `admin`.
 * Deshalb steht hier KEIN zusätzliches Gate, sondern ein ehrlicher Hinweis für
 * Redakteure: Sie sehen die Seite, dürfen aber nichts ändern. Ein Verstecken
 * wäre irreführender — der Navigations-Eintrag ist bereits rollenbeschränkt.
 */
export default async function AdminTeamPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const viewer = await readPageViewer(tenant);

  return (
    <div>
      <AdminPageHeader title={t("admin.team.title")} subtitle={t("admin.team.subtitle")} />
      <Card>
        {viewer ? (
          <TeamManager
            locale={tenant.defaultLocale}
            viewerRole={(viewer.role as "user" | "content" | "admin" | "owner") ?? "user"}
            viewerEmail={viewer.email}
          />
        ) : null}
      </Card>
    </div>
  );
}
