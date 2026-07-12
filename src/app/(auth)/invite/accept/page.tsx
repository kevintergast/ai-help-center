import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { AuthCard } from "@/components/auth/auth-card";
import { InviteAcceptPanel } from "@/components/auth/invite-accept-panel";
import { first } from "@/lib/auth/search-params";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function InviteAcceptPage({ searchParams }: { searchParams: SearchParams }) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const sp = await searchParams;

  return (
    <AuthCard title={t("auth.invite.title")}>
      <InviteAcceptPanel locale={tenant.defaultLocale} token={first(sp.token) ?? null} />
    </AuthCard>
  );
}
