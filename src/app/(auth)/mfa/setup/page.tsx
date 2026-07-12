import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { AuthCard } from "@/components/auth/auth-card";
import { MfaSetupPanel } from "@/components/auth/mfa-setup-panel";

export default async function MfaSetupPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);

  return (
    <AuthCard title={t("auth.mfa.title")}>
      <MfaSetupPanel locale={tenant.defaultLocale} />
    </AuthCard>
  );
}
