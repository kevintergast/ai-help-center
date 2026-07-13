import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { fakeAdmin } from "@/lib/admin/fake-admin";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { BarChart } from "@/components/admin/charts";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

export default async function AdminStatsPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const nf = new Intl.NumberFormat(tenant.defaultLocale === "de" ? "de-DE" : "en-US");
  const questions = fakeAdmin.questionsSeries();
  const top = fakeAdmin.topQuestions();
  const articles = [...fakeAdmin.articles()].sort((a, b) => b.usedIn - a.usedIn).slice(0, 5);

  const periodOptions = [
    { value: "7", label: t("admin.stats.period7") },
    { value: "30", label: t("admin.stats.period30") },
    { value: "90", label: t("admin.stats.period90") },
  ];

  return (
    <div>
      <AdminPageHeader
        title={t("admin.stats.title")}
        subtitle={t("admin.stats.subtitle")}
        action={
          <div className="flex items-center gap-3">
            <Switch label={t("admin.stats.hideInternal")} defaultChecked />
            <Select options={periodOptions} defaultValue="30" aria-label={t("admin.stats.period30")} />
          </div>
        }
      />

      <section className="rounded-card border border-hairline bg-surface p-5">
        <h2 className="mb-4 text-sm font-medium text-ink-muted">{t("admin.stats.questionsOverTime")}</h2>
        <BarChart values={questions} aria-label={t("admin.stats.questionsOverTime")} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-card border border-hairline bg-surface p-5">
          <h2 className="mb-4 font-semibold tracking-[-0.3px]">{t("admin.stats.topQuestions")}</h2>
          <ul className="flex flex-col divide-y divide-hairline">
            {top.map((q) => (
              <li key={q.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{q.text}</span>
                  <span className="text-xs text-ink-muted">
                    {q.grounded ? t("admin.stats.grounded") : t("admin.stats.notGrounded")}
                  </span>
                </span>
                {q.grounded ? null : <Badge tone="warn">{t("admin.stats.notGrounded")}</Badge>}
                <span className="tabular-nums text-sm font-medium text-ink">{nf.format(q.count)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-card border border-hairline bg-surface p-5">
          <h2 className="mb-4 font-semibold tracking-[-0.3px]">{t("admin.stats.topArticles")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs uppercase tracking-[0.04em] text-ink-muted">
                  <th className="py-2 pr-3 font-medium">{t("admin.col.title")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("admin.col.usedIn")}</th>
                  <th className="py-2 text-right font-medium">{t("admin.col.helpful")}</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((a) => (
                  <tr key={a.id} className="border-b border-hairline last:border-b-0">
                    <td className="py-2.5 pr-3 text-ink">{a.title}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink-muted">
                      {nf.format(a.usedIn)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink-muted">{a.helpfulPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
