import Link from "next/link";
import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default async function ForgotPasswordPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);

  return (
    <AuthCard
      title={t("auth.forgot.title")}
      subtitle={t("auth.forgot.subtitle")}
      footer={
        <Link href="/login" className="text-brand hover:underline">
          {t("auth.forgot.backToLogin")}
        </Link>
      }
    >
      <ForgotPasswordForm locale={tenant.defaultLocale} />
    </AuthCard>
  );
}
