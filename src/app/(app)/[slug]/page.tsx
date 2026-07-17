import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentTenant } from "@/lib/tenant/current";
import { readPageViewer } from "@/server/auth/page-guard";
import { getHelpCenterData, getHelpCenterRepo } from "@/server/content/runtime";
import { ArticlePage } from "@/components/help-center/article-page";

/**
 * Öffentliche SSR-Artikelseite unter `/<slug>` (Endnutzer-Hilfezentrum).
 *
 * Servergerendert für SEO/Teilbarkeit: eigenes `<title>`/Meta (generateMetadata)
 * + Article-JSON-LD. Nur VERÖFFENTLICHTE Artikel sind auflösbar (der Repo-
 * Lesepfad filtert `status='published'`); alles andere → notFound().
 *
 * Routing: explizite App-Routen (/login, /admin, /console, /legal, …) haben in
 * Next Vorrang vor diesem dynamischen Segment. Damit ein Artikel-Slug nie in
 * einem dieser Namen „verschwindet", verbietet die Content-Validierung
 * (server/content/validate.ts) reservierte Slugs bereits beim Anlegen.
 */

async function loadArticle(slug: string) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const repo = await getHelpCenterRepo(tenant);
  const article = await repo.getArticle(slug);
  if (!article) return null;
  return { tenant, repo, article };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadArticle(slug);
  if (!loaded) return {};
  const { tenant, article } = loaded;
  const description = (article.body[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 155);
  return {
    title: `${article.title} · ${tenant.name}`,
    description: description || undefined,
    openGraph: {
      title: article.title,
      description: description || undefined,
      type: "article",
      siteName: tenant.name,
    },
  };
}

export default async function ArticleRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const loaded = await loadArticle(slug);
  if (!loaded) notFound();
  const { tenant, repo, article } = loaded;

  // Lese-Bundle für Sidebar/Navigation der gemeinsamen Shell.
  const data = await getHelpCenterData(tenant);

  // Sprachfassungen (Translation-Set) für den Umschalter — nur published.
  const siblings = article.articleKey ? await repo.siblingsOf(article.articleKey) : [];

  // Verwandte Artikel (IDs → Summaries mit slug für die Verlinkung).
  const summaries = await repo.searchItems();
  const byId = new Map(summaries.map((a) => [a.id, a]));
  const related = article.relatedIds
    .map((id) => byId.get(id))
    .filter((a): a is NonNullable<typeof a> => a !== undefined);

  const description = (article.body[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description,
    articleBody: article.body.join("\n\n"),
    inLanguage: tenant.defaultLocale,
    articleSection: article.category,
    publisher: { "@type": "Organization", name: tenant.name },
  };

  return (
    <>
      <script
        type="application/ld+json"
        // JSON.stringify + `<`-Escape verhindert ein vorzeitiges </script>.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <ArticlePage
        locale={tenant.defaultLocale}
        tenantName={tenant.name}
        logoUrl={tenant.branding.logoUrl}
        article={article}
        related={related}
        data={data}
        isOperator={tenant.id === "t_operator"}
        viewer={await readPageViewer(tenant)}
        siblings={siblings}
      />
    </>
  );
}
