import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { first } from "@/lib/auth/search-params";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const sp = await searchParams;

  return (
    <AuthCard title={t("auth.reset.title")} subtitle={t("auth.reset.subtitle")}>
      <ResetPasswordForm locale={tenant.defaultLocale} token={first(sp.token) ?? null} />
    </AuthCard>
  );
}
