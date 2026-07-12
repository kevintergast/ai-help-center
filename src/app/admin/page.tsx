import Link from "next/link";
import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import type { MessageKey } from "@/i18n/messages/de";
import { fakeAdmin } from "@/lib/admin/fake-admin";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { TICKET_STATUS } from "@/components/admin/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartBarIcon, InboxIcon, SettingsIcon, PlusIcon } from "@/components/ui/icons";

const KPI_LABEL: Record<string, MessageKey> = {
  questions: "admin.kpi.questions",
  grounded: "admin.kpi.grounded",
  articles: "admin.kpi.articles",
  stale: "admin.kpi.stale",
};

export default async function AdminOverviewPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const kpis = fakeAdmin.kpis();
  const tickets = fakeAdmin.tickets().slice(0, 3);

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
        action={
          <Link href="/admin/articles">
            <Button variant="primary" size="sm">
              <PlusIcon width={16} height={16} />
              {t("admin.new")}
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiCard
            key={k.id}
            label={t(KPI_LABEL[k.id])}
            value={k.value}
            deltaPct={k.deltaPct}
            deltaSuffix={t("admin.kpi.vsLastWeek")}
            spark={k.spark}
          />
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="rounded-card border border-hairline bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold tracking-[-0.3px]">{t("admin.overview.recentIssues")}</h2>
            <Link href="/admin/inbox" className="text-sm text-brand hover:underline">
              {t("admin.seeAll")}
            </Link>
          </div>
          <ul className="flex flex-col divide-y divide-hairline">
            {tickets.map((tk) => (
              <li key={tk.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{tk.subject}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {tk.from} · {tk.timeLabel}
                  </span>
                </span>
                <Badge tone={TICKET_STATUS[tk.status].tone} dot>
                  {t(TICKET_STATUS[tk.status].key)}
                </Badge>
              </li>
            ))}
          </ul>
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
