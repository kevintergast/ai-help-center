import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentTenant } from "@/lib/tenant/current";
import { readPageViewer } from "@/server/auth/page-guard";
import { getT } from "@/i18n/t";
import { AccountPanel } from "@/components/account/account-panel";
import { ArrowLeftIcon } from "@/components/ui/icons";

/**
 * KONTO-SEITE für JEDE angemeldete Rolle — auch für normale Nutzer, die nur
 * ein Konto haben, damit ihre gespeicherten Antworten erhalten bleiben.
 *
 * KEIN Team-Gate: Das hier ist das eigene Konto, nicht die Instanz. Wer nicht
 * angemeldet ist, landet beim Login und kommt danach zurück.
 *
 * Bewusst unter `(app)` statt im Verwaltungsbereich: Der Admin-Bereich gated
 * auf `content` und würde normale Nutzer aussperren — also genau die, denen
 * bisher jede Konto-Verwaltung fehlte.
 */
export const metadata: Metadata = { robots: { index: false } };

export default async function AccountPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const viewer = await readPageViewer(tenant);
  if (!viewer) redirect("/login?redirect=/account");

  const t = getT(tenant.defaultLocale);

  return (
    <div className="min-h-screen bg-page text-ink">
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <Link href="/" className="text-sm text-ink-muted transition-colors hover:text-ink">
          <ArrowLeftIcon width={16} height={16} className="mr-1.5 inline" />
          {t("hc.backToOverview")}
        </Link>
        <h1 className="mb-6 mt-4 text-[30px] font-semibold leading-tight tracking-[-0.6px]">
          {t("account.title")}
        </h1>
        <AccountPanel
          locale={tenant.defaultLocale}
          name={viewer.name}
          email={viewer.email}
          role={viewer.role}
          twoFactorEnabled={viewer.twoFactorEnabled === true}
        />
      </main>
    </div>
  );
}
