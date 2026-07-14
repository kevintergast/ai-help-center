import Link from "next/link";
import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { getAvailableSocialProviders } from "@/server/auth/social-availability";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { first } from "@/lib/auth/search-params";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const sp = await searchParams;
  const providers = await getAvailableSocialProviders();

  return (
    <AuthCard
      title={t("auth.login.title")}
      subtitle={t("auth.login.subtitle")}
      footer={
        <>
          {t("auth.login.noAccount")}{" "}
          <Link href="/signup" className="text-brand hover:underline">
            {t("auth.login.signupLink")}
          </Link>
        </>
      }
    >
      <LoginForm
        locale={tenant.defaultLocale}
        socialProviders={providers}
        requestedRedirect={first(sp.redirect) ?? null}
        verified={first(sp.verified) === "1"}
        socialError={first(sp.error) === "social"}
      />
    </AuthCard>
  );
}
