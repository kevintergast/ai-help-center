import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { fakeAdmin } from "@/lib/admin/fake-admin";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/ui/cn";

export default async function AdminPlanPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const nf = new Intl.NumberFormat(tenant.defaultLocale === "de" ? "de-DE" : "en-US");
  const u = fakeAdmin.usage();
  const plans = fakeAdmin.plans();
  const invoices = fakeAdmin.invoices();

  const creditsPct = Math.round((u.creditsUsed / u.creditsIncluded) * 100);
  const mauPct = Math.round((u.mauUsed / u.mauIncluded) * 100);

  return (
    <div>
      <AdminPageHeader
        title={t("admin.plan.title")}
        subtitle={t("admin.plan.subtitle")}
        action={
          <Button variant="primary" size="sm">
            {t("admin.plan.manage")}
          </Button>
        }
      />

      <Banner
        tone="warn"
        title={t("admin.plan.graceTitle", { days: u.graceDays })}
        description={t("admin.plan.graceDesc")}
        action={
          <Button variant="primary" size="sm">
            {t("admin.plan.upgrade")}
          </Button>
        }
        className="mb-6"
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-container border border-hairline bg-surface p-6">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="text-sm text-ink-muted">{t("admin.plan.current")}</h2>
            <span className="text-[22px] font-semibold tracking-[-0.5px]">
              {u.planName} · {u.planPrice}
              <span className="text-sm font-normal text-ink-muted">{t("admin.plan.perMonth")}</span>
            </span>
          </div>
          <Meter
            label={t("admin.plan.credits")}
            value={`${nf.format(u.creditsUsed)} / ${nf.format(u.creditsIncluded)}`}
            percent={creditsPct}
            warn={creditsPct >= 100}
            className="my-4"
          />
          <Meter
            label={t("admin.plan.mau")}
            value={`${nf.format(u.mauUsed)} / ${nf.format(u.mauIncluded)}`}
            percent={mauPct}
            className="my-4"
          />
          <div className="mt-4 flex items-center justify-between border-t border-hairline pt-4 text-sm">
            <span className="text-ink-muted">{t("admin.plan.overage")}</span>
            <span className="tabular-nums text-ink">
              {nf.format(u.overageCredits)} · {u.overageAmount}
            </span>
          </div>
          <p className="mt-3 text-xs text-ink-muted">{t("admin.plan.reset", { date: u.resetDate })}</p>
        </section>

        <section className="flex flex-col gap-3">
          {plans.map((p) => (
            <div
              key={p.id}
              className={cn(
                "rounded-card border bg-surface p-4",
                p.current ? "border-brand" : "border-hairline",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">{p.name}</span>
                {p.current ? (
                  <Badge tone="brand" dot>
                    {t("admin.plan.current")}
                  </Badge>
                ) : (
                  <Button variant="ghost" size="sm">
                    {t("admin.plan.upgrade")}
                  </Button>
                )}
              </div>
              <div className="mt-1 text-lg font-semibold tracking-[-0.4px]">
                {p.price}
                <span className="text-sm font-normal text-ink-muted">{t("admin.plan.perMonth")}</span>
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">
                {t("admin.plan.included", { n: p.includedLabel })}
              </p>
            </div>
          ))}
        </section>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-semibold tracking-[-0.3px]">{t("admin.plan.invoices")}</h2>
        <div className="overflow-x-auto rounded-card border border-hairline">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-[0.04em] text-ink-muted">
                <th className="px-4 py-3 font-medium">{t("admin.col.date")}</th>
                <th className="px-4 py-3 font-medium">{t("admin.col.invoice")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("admin.col.amount")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-hairline last:border-b-0">
                  <td className="px-4 py-3 text-ink">{inv.dateLabel}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-muted">{inv.number}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{inv.amount}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="cream" size="sm">
                      {"PDF"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
