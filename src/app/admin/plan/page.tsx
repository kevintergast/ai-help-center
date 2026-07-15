import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import type { MessageKey } from "@/i18n/messages/de";
import { getPlanOverview } from "@/server/billing/runtime";
import type { PlanId } from "@/server/billing/pricing";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Meter } from "@/components/ui/meter";
import { cn } from "@/lib/ui/cn";

/**
 * Plan & Credits mit ECHTEN Zahlen (tenant_usage/tenant_plan + pricing.ts,
 * Infra-Plan Schritt 3/5). Overage ist eine BERECHNUNG (Vorschau) — Zahlungen/
 * Rechnungen kommen erst mit Paddle (nach Firmengründung), deshalb gibt es
 * hier bewusst keine Upgrade-/Verwalten-Buttons und einen ehrlichen
 * Hinweis statt einer Fake-Rechnungstabelle.
 */

const PLAN_NAME: Record<PlanId, MessageKey> = {
  free: "admin.plan.name.free",
  starter: "admin.plan.name.starter",
  scale: "admin.plan.name.scale",
};

export default async function AdminPlanPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const isDe = tenant.defaultLocale === "de";
  const nf = new Intl.NumberFormat(isDe ? "de-DE" : "en-US");
  const cf = new Intl.NumberFormat(isDe ? "de-DE" : "en-US", {
    style: "currency",
    currency: "EUR",
  });
  const df = new Intl.DateTimeFormat(isDe ? "de-DE" : "en-US", { dateStyle: "long" });

  const u = await getPlanOverview(tenant);
  const creditsUsed = u?.creditsUsed ?? 0;
  const includedCredits = u?.includedCredits ?? 1;
  const mauCount = u?.mauCount ?? 0;
  const mauLimit = u?.mauLimit ?? 1;
  const creditsPct = Math.min(100, Math.round((creditsUsed / includedCredits) * 100));
  const mauPct = Math.min(100, Math.round((mauCount / mauLimit) * 100));

  return (
    <div>
      <AdminPageHeader title={t("admin.plan.title")} subtitle={t("admin.plan.subtitle")} />

      {u?.status === "over_limit" ? (
        <Banner
          tone="warn"
          title={t("admin.plan.graceTitle", { days: u.graceDaysLeft ?? 0 })}
          description={t("admin.plan.graceDesc")}
          className="mb-6"
        />
      ) : null}
      {u?.status === "frozen" ? (
        <Banner
          tone="crit"
          title={t("admin.plan.frozenTitle")}
          description={t("admin.plan.frozenDesc")}
          className="mb-6"
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-container border border-hairline bg-surface p-6">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="text-sm text-ink-muted">{t("admin.plan.current")}</h2>
            <span className="text-[22px] font-semibold tracking-[-0.5px]">
              {t(PLAN_NAME[u?.planId ?? "free"])} · {cf.format((u?.baseFeeCents ?? 0) / 100)}
              <span className="text-sm font-normal text-ink-muted">{t("admin.plan.perMonth")}</span>
            </span>
          </div>
          <Meter
            label={t("admin.plan.credits")}
            value={`${nf.format(creditsUsed)} / ${nf.format(u?.includedCredits ?? 0)}`}
            percent={creditsPct}
            warn={creditsPct >= 100}
            className="my-4"
          />
          <Meter
            label={t("admin.plan.mau")}
            value={`${nf.format(mauCount)} / ${nf.format(u?.mauLimit ?? 0)}`}
            percent={mauPct}
            warn={mauPct >= 100}
            className="my-4"
          />
          <div className="mt-4 flex items-center justify-between border-t border-hairline pt-4 text-sm">
            <span className="text-ink-muted">{t("admin.plan.overage")}</span>
            <span className="tabular-nums text-ink">
              {nf.format(u?.overageCredits ?? 0)} · {cf.format((u?.overageAmountCents ?? 0) / 100)}
            </span>
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            {t("admin.plan.reset", { date: u ? df.format(new Date(u.resetMs)) : "—" })}
          </p>
        </section>

        <section className="flex flex-col gap-3">
          {(u?.plans ?? []).map((p) => (
            <div
              key={p.id}
              className={cn(
                "rounded-card border bg-surface p-4",
                p.current ? "border-brand" : "border-hairline",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">{t(PLAN_NAME[p.id])}</span>
                {p.current ? (
                  <Badge tone="brand" dot>
                    {t("admin.plan.current")}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-1 text-lg font-semibold tracking-[-0.4px]">
                {cf.format(p.baseFeeCents / 100)}
                <span className="text-sm font-normal text-ink-muted">{t("admin.plan.perMonth")}</span>
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">
                {t("admin.plan.included", { n: nf.format(p.includedCredits) })}
              </p>
            </div>
          ))}
          {/* Upgrade/Checkout folgt mit Paddle (provider-agnostischer Billing-Layer). */}
          <p className="px-1 text-xs text-ink-muted">{t("admin.plan.paymentsSoon")}</p>
        </section>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-semibold tracking-[-0.3px]">{t("admin.plan.invoices")}</h2>
        <div className="rounded-card border border-hairline p-5">
          <p className="text-sm text-ink-muted">{t("admin.plan.invoicesNone")}</p>
        </div>
      </section>
    </div>
  );
}
