import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { listAdminArticleRows } from "@/server/content/runtime";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { ArticlesTable } from "@/components/admin/articles-table";
import { ContentTransfer } from "@/components/admin/content-transfer";
import { NewArticleButton } from "@/components/admin/new-article-button";

export default async function AdminArticlesPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  // Echte, tenant-gebundene Artikelzeilen aus D1 inkl. usage_events-Aggregaten
  // (Views/Hilfreich/Verwendet); Suche + Status-Filter laufen client-seitig
  // in der ArticlesTable (Fallback ohne CF-Kontext: Sample-Daten).
  const rows = await listAdminArticleRows(tenant);

  return (
    <div>
      <AdminPageHeader
        title={t("admin.articles.title")}
        subtitle={t("admin.articles.subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ContentTransfer locale={tenant.defaultLocale} />
            <NewArticleButton locale={tenant.defaultLocale} />
          </div>
        }
      />

      <ArticlesTable rows={rows} locale={tenant.defaultLocale} />
    </div>
  );
}
