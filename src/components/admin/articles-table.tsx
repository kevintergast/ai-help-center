"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AdminArticleRow } from "@/lib/admin/types";
import { filterArticleGroups, groupArticleRows } from "@/lib/admin/group-articles";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { ARTICLE_STATUS } from "@/components/admin/status";
import { Badge } from "@/components/ui/badge";
import { SearchBar } from "@/components/ui/search-bar";
import { Select } from "@/components/ui/select";

/**
 * Artikel-Tabelle mit verdrahteter Suche + Status-Filter. TRANSLATION-SETS
 * (gleicher articleKey) erscheinen als EIN Eintrag: die Zeile gehört dem
 * Original (Standardsprache), weitere Sprachen hängen als Chips daran —
 * Klick öffnet die Fassung im Editor. Ein warn-Chip heißt: das Original
 * wurde seit der letzten Bearbeitung dieser Übersetzung geändert
 * (Staleness-Regel in group-articles.ts).
 */
export function ArticlesTable({ rows, locale }: { rows: AdminArticleRow[]; locale: Locale }) {
  const t = getT(locale);
  const nf = new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-US");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

  const statusOptions = [
    { value: "all", label: t("admin.articles.filterAll") },
    { value: "current", label: t("hc.status.current") },
    { value: "stale", label: t("hc.status.stale") },
    { value: "ai", label: t("hc.status.ai") },
    { value: "draft", label: t("hc.status.draft") },
  ];

  const groups = useMemo(() => groupArticleRows(rows, locale), [rows, locale]);
  const filtered = useMemo(
    () => filterArticleGroups(groups, query, status),
    [groups, query, status],
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar
          placeholder={t("admin.articles.searchPlaceholder")}
          aria-label={t("admin.articles.searchAria")}
          className="min-w-[240px] flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          options={statusOptions}
          value={status}
          onValueChange={setStatus}
          aria-label={t("admin.articles.filterStatus")}
        />
        <span className="text-sm text-ink-muted">
          {t("admin.articles.count", { n: filtered.length })}
        </span>
      </div>

      <div className="overflow-x-auto rounded-card border border-hairline">
        <table className="w-full min-w-[780px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-[0.04em] text-ink-muted">
              <th className="px-4 py-3 font-medium">{t("admin.col.title")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.col.category")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.col.status")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.col.languages")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("admin.col.views")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("admin.col.helpful")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("admin.col.usedIn")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.col.updated")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => {
              const r = g.primary;
              const empty = r.status === "draft";
              return (
                <tr
                  key={r.articleKey}
                  className="border-b border-hairline last:border-b-0 transition-colors hover:bg-tint"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/admin/articles/${r.id}`}
                      className="text-ink hover:text-brand hover:underline"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{r.category}</td>
                  <td className="px-4 py-3">
                    <Badge tone={ARTICLE_STATUS[r.status].tone} dot>
                      {t(ARTICLE_STATUS[r.status].key)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-hairline bg-tint px-2 py-0.5 text-[11px] font-semibold uppercase text-ink-muted">
                        {r.locale}
                      </span>
                      {g.siblings.map((s) => (
                        <Link
                          key={s.row.id}
                          href={`/admin/articles/${s.row.id}`}
                          title={
                            s.stale
                              ? t("admin.articles.staleTranslation")
                              : t("admin.articles.openTranslation", {
                                  locale: s.row.locale.toUpperCase(),
                                })
                          }
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase transition-colors hover:underline ${
                            s.stale
                              ? "border-warn/40 bg-warn/10 text-warn"
                              : "border-hairline bg-surface text-brand"
                          }`}
                        >
                          {s.row.locale}
                          {s.stale ? " !" : ""}
                        </Link>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {empty ? "—" : nf.format(r.views)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {empty || r.helpfulPct === null ? "—" : `${r.helpfulPct}%`}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {empty ? "—" : nf.format(r.usedIn)}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{r.updatedLabel}</td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-ink-muted">
                  {t("admin.articles.noMatches")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
