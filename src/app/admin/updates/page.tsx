import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { UpdatesManager } from "@/components/admin/updates-manager";

/**
 * PRODUKT-UPDATES (Changelog + Roadmap). Das Admin-Layout gated bereits auf
 * `content` — dieselbe Schwelle wie die API (api/updates.ts), also kein
 * zusätzliches Gate hier.
 */
export default async function AdminUpdatesPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);

  return (
    <div>
      <AdminPageHeader title={t("admin.updates.title")} subtitle={t("admin.updates.subtitle")} />
      <UpdatesManager locale={tenant.defaultLocale} />
    </div>
  );
}
