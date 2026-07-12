import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { AuthCard } from "@/components/auth/auth-card";
import { MfaChallengePanel } from "@/components/auth/mfa-challenge-panel";
import { first } from "@/lib/auth/search-params";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MfaChallengePage({ searchParams }: { searchParams: SearchParams }) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const sp = await searchParams;

  return (
    <AuthCard title={t("auth.mfaChallenge.title")} subtitle={t("auth.mfaChallenge.body")}>
      <MfaChallengePanel
        locale={tenant.defaultLocale}
        requestedRedirect={first(sp.redirect) ?? null}
      />
    </AuthCard>
  );
}
