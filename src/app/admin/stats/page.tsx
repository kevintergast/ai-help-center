import Link from "next/link";
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
export default async function AdminStatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const nf = new Intl.NumberFormat(tenant.defaultLocale === "de" ? "de-DE" : "en-US");

  // Schalter „interne Team-Aufrufe einblenden" (?internal=1): reine Sicht-
  // Änderung — interne Nutzung kostet NIE Credits (Architektur-Entscheidung).
  const includeInternal = (await searchParams).internal === "1";
  const stats = await getStatsOverview(tenant, { includeInternal });
  const series = stats?.series ?? [];
  const topArticles = stats?.topArticles ?? [];
  const feedback = stats?.feedback ?? { byArticle: {}, answers: { helpful: 0, unhelpful: 0 } };
  const answerVotes = feedback.answers.helpful + feedback.answers.unhelpful;
  const totalVotes =
    answerVotes +
    Object.values(feedback.byArticle).reduce((sum, f) => sum + f.helpful + f.unhelpful, 0);

  return (
    <div>
      <AdminPageHeader title={t("admin.stats.title")} subtitle={t("admin.stats.subtitle")} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={includeInternal ? "/admin/stats" : "/admin/stats?internal=1"}
          className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-tint"
        >
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${includeInternal ? "bg-brand" : "bg-ink-muted/40"}`}
          />
          {includeInternal ? t("admin.stats.hideInternal") : t("admin.stats.showInternal")}
        </Link>
        {includeInternal ? (
          <p className="text-xs text-ink-muted">{t("admin.stats.internalNote")}</p>
        ) : null}
      </div>

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
                    <th className="py-2 pr-3 text-right font-medium">{t("admin.col.views")}</th>
                    <th className="py-2 text-right font-medium">{t("admin.stats.helpful")}</th>
                  </tr>
                </thead>
                <tbody>
                  {topArticles.map((a) => {
                    const fb = feedback.byArticle[a.articleId];
                    const votes = fb ? fb.helpful + fb.unhelpful : 0;
                    return (
                      <tr key={a.articleId} className="border-b border-hairline last:border-b-0">
                        <td className="py-2.5 pr-3 text-ink">{a.title}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-ink-muted">
                          {nf.format(a.views)}
                        </td>
                        <td
                          className="py-2.5 text-right tabular-nums text-ink-muted"
                          title={
                            votes > 0
                              ? t("admin.stats.helpfulVotes", {
                                  yes: nf.format(fb?.helpful ?? 0),
                                  total: nf.format(votes),
                                })
                              : undefined
                          }
                        >
                          {votes > 0 ? `${Math.round(((fb?.helpful ?? 0) / votes) * 100)} %` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {answerVotes > 0 ? (
                <p className="mt-3 text-xs text-ink-muted">
                  {t("admin.stats.answerFeedback")}:{" "}
                  {Math.round((feedback.answers.helpful / answerVotes) * 100)} % ·{" "}
                  {t("admin.stats.helpfulVotes", {
                    yes: nf.format(feedback.answers.helpful),
                    total: nf.format(answerVotes),
                  })}
                </p>
              ) : totalVotes === 0 ? (
                <p className="mt-3 text-xs text-ink-muted">{t("admin.stats.helpfulEmpty")}</p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
