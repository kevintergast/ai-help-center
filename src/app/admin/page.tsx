import Link from "next/link";
import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { getAdminUsageKpis } from "@/server/billing/runtime";
import { listAdminArticleRows } from "@/server/content/runtime";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { NewArticleButton } from "@/components/admin/new-article-button";
import { ChartBarIcon, InboxIcon, SettingsIcon, PlusIcon } from "@/components/ui/icons";

/**
 * Admin-Übersicht mit ECHTEN Kennzahlen (usage_events/tenant_usage, Schritt 3
 * des Infra-Plans — keine Mockdaten mehr). Ohne D1 (reines next dev) zeigen
 * die Kacheln 0; die Ticket-Liste ist ein ehrlicher Leerzustand, bis der
 * Support-Flow existiert.
 */
export default async function AdminOverviewPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const nf = new Intl.NumberFormat(tenant.defaultLocale === "de" ? "de-DE" : "en-US");

  const [kpis, articles] = await Promise.all([
    getAdminUsageKpis(tenant),
    listAdminArticleRows(tenant),
  ]);
  const publishedCount = articles.filter((a) => a.status !== "draft").length;

  const quickActions = [
    { href: "/admin/articles", label: t("admin.new"), icon: PlusIcon },
    { href: "/admin/stats", label: t("admin.overview.viewStats"), icon: ChartBarIcon },
    { href: "/admin/inbox", label: t("admin.overview.openInbox"), icon: InboxIcon },
    { href: "/admin/settings", label: t("admin.overview.editBranding"), icon: SettingsIcon },
  ];

  return (
    <div>
      <AdminPageHeader
        title={t("admin.overview.title")}
        subtitle={t("admin.overview.subtitle")}
        action={<NewArticleButton locale={tenant.defaultLocale} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("admin.kpi.views")}
          value={nf.format(kpis?.views30 ?? 0)}
          deltaPct={kpis?.viewsDeltaPct ?? undefined}
          deltaSuffix={t("admin.kpi.vsPrevPeriod")}
          spark={kpis?.viewsSpark ?? []}
        />
        <KpiCard label={t("admin.kpi.mau")} value={nf.format(kpis?.mauCount ?? 0)} />
        <KpiCard label={t("admin.kpi.credits")} value={nf.format(kpis?.creditsUsed ?? 0)} />
        <KpiCard label={t("admin.kpi.articles")} value={nf.format(publishedCount)} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="rounded-card border border-hairline bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold tracking-[-0.3px]">{t("admin.overview.recentIssues")}</h2>
            <Link href="/admin/inbox" className="text-sm text-brand hover:underline">
              {t("admin.seeAll")}
            </Link>
          </div>
          {/* Support-Flow ist eine spätere Phase — ehrlicher Leerzustand statt Fake-Tickets. */}
          <p className="py-6 text-sm text-ink-muted">{t("admin.inbox.none")}</p>
        </section>

        <section className="rounded-card border border-hairline bg-surface p-5">
          <h2 className="mb-4 font-semibold tracking-[-0.3px]">{t("admin.overview.quickActions")}</h2>
          <div className="flex flex-col gap-2">
            {quickActions.map((a) => {
              const Icon = a.icon;
              return (
                <Link
                  key={a.href}
                  href={a.href}
                  className="flex items-center gap-3 rounded-comfy border border-hairline bg-surface px-3 py-2.5 text-sm text-ink transition-colors hover:bg-tint"
                >
                  <Icon width={16} height={16} className="text-ink-muted" />
                  {a.label}
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
