import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { AuthCard } from "@/components/auth/auth-card";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";
import { first } from "@/lib/auth/search-params";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const sp = await searchParams;

  return (
    <AuthCard title={t("auth.verify.title")}>
      <VerifyEmailPanel locale={tenant.defaultLocale} email={first(sp.email) ?? null} />
    </AuthCard>
  );
}
