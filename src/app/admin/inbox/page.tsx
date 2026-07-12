import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { InboxView } from "@/components/admin/inbox-view";

export default async function AdminInboxPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  return (
    <div>
      <AdminPageHeader title={t("admin.inbox.title")} subtitle={t("admin.inbox.subtitle")} />
      <InboxView locale={tenant.defaultLocale} />
    </div>
  );
}
