import Link from "next/link";
import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { fakeHelpCenterRepo } from "@/lib/content/fake-repo";
import { ArticleEditor } from "@/components/admin/article-editor";

export default async function AdminArticleEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const { id } = await params;
  const t = getT(tenant.defaultLocale);
  const article = fakeHelpCenterRepo.getArticle(id);

  if (!article) {
    return (
      <div>
        <Link href="/admin/articles" className="text-sm text-brand hover:underline">
          {t("editor.back")}
        </Link>
        <p className="mt-4 text-ink-muted">{t("admin.articles.searchEmpty")}</p>
      </div>
    );
  }

  return <ArticleEditor locale={tenant.defaultLocale} article={article} />;
}
