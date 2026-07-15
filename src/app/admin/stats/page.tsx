import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { getStatsOverview } from "@/server/billing/runtime";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { BarChart } from "@/components/admin/charts";

/**
 * Statistik mit ECHTEN Nutzungsdaten (usage_events, 30-Tage-Fenster, interne
 * Team-Aufrufe ausgeblendet — Architektur-Entscheidung). „Top-Fragen" erscheint
 * erst, wenn die KI-Generierung (RAG) live ist — bis dahin ehrlicher
 * Leerzustand statt erfundener Fragen. Zeitraum-/Filter-Steuerung kommt mit
 * dem Analytics-Ausbau (bewusst keine funktionslosen Controls).
 */
export default async function AdminStatsPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const nf = new Intl.NumberFormat(tenant.defaultLocale === "de" ? "de-DE" : "en-US");

  const stats = await getStatsOverview(tenant);
  const series = stats?.series ?? [];
  const topArticles = stats?.topArticles ?? [];

  return (
    <div>
      <AdminPageHeader title={t("admin.stats.title")} subtitle={t("admin.stats.subtitle")} />

      <section className="rounded-card border border-hairline bg-surface p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-ink-muted">{t("admin.stats.viewsOverTime")}</h2>
          <span className="text-sm tabular-nums text-ink">
            {t("admin.stats.total", { n: nf.format(stats?.totalViews ?? 0) })}
          </span>
        </div>
        {series.some((v) => v > 0) ? (
          <BarChart values={series} aria-label={t("admin.stats.viewsOverTime")} />
        ) : (
          <p className="py-8 text-sm text-ink-muted">{t("admin.stats.viewsEmpty")}</p>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-card border border-hairline bg-surface p-5">
          <h2 className="mb-4 font-semibold tracking-[-0.3px]">{t("admin.stats.topQuestions")}</h2>
          {/* Gefüllt, sobald der RAG-Kern KI-Fragen beantwortet (nächste Phase). */}
          <p className="py-6 text-sm text-ink-muted">{t("admin.stats.questionsEmpty")}</p>
        </section>

        <section className="rounded-card border border-hairline bg-surface p-5">
          <h2 className="mb-4 font-semibold tracking-[-0.3px]">{t("admin.stats.topArticles")}</h2>
          {topArticles.length === 0 ? (
            <p className="py-6 text-sm text-ink-muted">{t("admin.stats.viewsEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-xs uppercase tracking-[0.04em] text-ink-muted">
                    <th className="py-2 pr-3 font-medium">{t("admin.col.title")}</th>
                    <th className="py-2 text-right font-medium">{t("admin.col.views")}</th>
                  </tr>
                </thead>
                <tbody>
                  {topArticles.map((a) => (
                    <tr key={a.articleId} className="border-b border-hairline last:border-b-0">
                      <td className="py-2.5 pr-3 text-ink">{a.title}</td>
                      <td className="py-2.5 text-right tabular-nums text-ink-muted">
                        {nf.format(a.views)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
