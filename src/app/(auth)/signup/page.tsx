import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { getAvailableSocialProviders } from "@/server/auth/social-availability";
import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/signup-form";

export default async function SignupPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const providers = await getAvailableSocialProviders();

  return (
    <AuthCard
      title={t("auth.signup.title")}
      subtitle={t("auth.signup.subtitle")}
      footer={
        <>
          {t("auth.signup.haveAccount")}{" "}
          <a href="/login" className="text-brand hover:underline">
            {t("auth.signup.loginLink")}
          </a>
        </>
      }
    >
      <SignupForm locale={tenant.defaultLocale} socialProviders={providers} />
    </AuthCard>
  );
}
