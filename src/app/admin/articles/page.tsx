import Link from "next/link";
import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { fakeAdmin } from "@/lib/admin/fake-admin";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { ARTICLE_STATUS } from "@/components/admin/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/ui/search-bar";
import { Select } from "@/components/ui/select";
import { PlusIcon } from "@/components/ui/icons";

export default async function AdminArticlesPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const nf = new Intl.NumberFormat(tenant.defaultLocale === "de" ? "de-DE" : "en-US");
  const rows = fakeAdmin.articles();

  const statusOptions = [
    { value: "all", label: t("admin.articles.filterAll") },
    { value: "current", label: t("hc.status.current") },
    { value: "stale", label: t("hc.status.stale") },
    { value: "ai", label: t("hc.status.ai") },
    { value: "draft", label: t("hc.status.draft") },
  ];

  return (
    <div>
      <AdminPageHeader
        title={t("admin.articles.title")}
        subtitle={t("admin.articles.subtitle")}
        action={
          <Link href="/admin/articles">
            <Button variant="primary" size="sm">
              <PlusIcon width={16} height={16} />
              {t("admin.new")}
            </Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar
          placeholder={t("admin.articles.searchPlaceholder")}
          aria-label={t("admin.articles.searchAria")}
          className="min-w-[240px] flex-1"
        />
        <Select
          options={statusOptions}
          defaultValue="all"
          aria-label={t("admin.articles.filterStatus")}
        />
        <span className="text-sm text-ink-muted">{t("admin.articles.count", { n: rows.length })}</span>
      </div>

      <div className="overflow-x-auto rounded-card border border-hairline">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-[0.04em] text-ink-muted">
              <th className="px-4 py-3 font-medium">{t("admin.col.title")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.col.category")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.col.status")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("admin.col.views")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("admin.col.helpful")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("admin.col.usedIn")}</th>
              <th className="px-4 py-3 font-medium">{t("admin.col.updated")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const empty = r.status === "draft";
              return (
                <tr
                  key={r.id}
                  className="border-b border-hairline last:border-b-0 transition-colors hover:bg-tint"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/admin/articles/${r.id}`} className="text-ink hover:text-brand hover:underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{r.category}</td>
                  <td className="px-4 py-3">
                    <Badge tone={ARTICLE_STATUS[r.status].tone} dot>
                      {t(ARTICLE_STATUS[r.status].key)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {empty ? "—" : nf.format(r.views)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {empty ? "—" : `${r.helpfulPct}%`}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {empty ? "—" : nf.format(r.usedIn)}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{r.updatedLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
