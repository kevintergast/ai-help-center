import type { AdminArticleRow } from "@/lib/admin/types";
import type { ArticleTranslationInfo } from "@/lib/content/types";
import type { Article, HelpCenterData, HelpCenterRepository } from "@/lib/content/types";
import type { Tenant } from "@/lib/tenant/types";
import {
  SAMPLE_ARTICLES,
  groupByCategory,
  sampleHelpCenterRepo,
} from "@/lib/content/fake-repo";
import { D1BillingRepository } from "@/server/billing/store";
import { getDbSafe } from "@/server/db/client";
import { D1ContentRepository } from "./store";

/**
 * SERVER-Accessoren fürs Hilfezentrum/Admin.
 *
 * D1 vorhanden (Worker / `next dev` mit Bindings): echte, tenant-gebundene
 * Persistenz. KEIN D1 (reines `next dev` / Unit-Tests ohne Cloudflare-Kontext):
 * Fallback auf die Sample-Daten (src/lib/content/fake-repo.ts), DAMIT die UI
 * lokal etwas zeigt — analog zur Tenant-Demo-Registry. Der Fallback ist NUR
 * lesend; Pflege läuft ausschließlich über die D1-gestützte Admin-API (die ohne
 * Binding 503 antwortet).
 */

/** Bindet einen D1ContentRepository an EINEN Tenant + Locale zur (no-arg) Lese-Fassade. */
function d1HelpCenterRepo(db: D1Database, tenant: Tenant): HelpCenterRepository {
  const store = new D1ContentRepository(db);
  const tid = tenant.id;
  const locale = tenant.defaultLocale;
  return {
    listByCategory: () => store.listByCategory(tid, locale),
    searchItems: () => store.searchItems(tid, locale),
    listArticles: () => store.listPublishedArticles(tid, locale),
    getArticle: (key) => store.getPublishedArticleBySlugOrId(tid, locale, key),
    siblingsOf: (articleKey) => store.getPublishedSiblings(tid, articleKey),
    // RAG-STUB (Punkt 3): geerdete Beispielantwort über die echten Artikel.
    roadmap: () => store.roadmap(tid),
    changelog: () => store.changelog(tid, locale),
    // Prompt-Vorschläge sind (noch) nicht in D1 modelliert → statisches Sample.
    promptSuggestions: () => sampleHelpCenterRepo.promptSuggestions(),
  };
}

/** Lese-Repository des aktuellen Tenants (D1 oder Sample-Fallback). */
export async function getHelpCenterRepo(tenant: Tenant): Promise<HelpCenterRepository> {
  const db = await getDbSafe();
  return db ? d1HelpCenterRepo(db, tenant) : sampleHelpCenterRepo;
}

/** Vorab aufgelöstes Lese-Bundle fürs (Client-)Hilfezentrum. */
export async function getHelpCenterData(tenant: Tenant): Promise<HelpCenterData> {
  const repo = await getHelpCenterRepo(tenant);
  const [groups, searchItems, articles, roadmap, changelog, suggestions] = await Promise.all([
    repo.listByCategory(),
    repo.searchItems(),
    repo.listArticles(),
    repo.roadmap(),
    repo.changelog(),
    repo.promptSuggestions(),
  ]);
  return { groups, searchItems, articles, roadmap, changelog, suggestions };
}

/**
 * Admin-Artikelzeilen des aktuellen Tenants (alle Status) — die Spalten
 * Views/Hilfreich/Verwendet kommen aus den ECHTEN usage_events-Aggregaten
 * (Billing-Store, interne Team-Aufrufe wie im Statistik-Default ausgeblendet).
 */
export async function listAdminArticleRows(tenant: Tenant): Promise<AdminArticleRow[]> {
  const db = await getDbSafe();
  if (db) {
    const [rows, stats] = await Promise.all([
      new D1ContentRepository(db).listAdminRows(tenant.id, tenant.defaultLocale),
      new D1BillingRepository(db).getArticleUsageStats(tenant.id),
    ]);
    return rows.map((r) => ({
      ...r,
      ...(stats[r.id] ?? { views: 0, helpfulPct: null, usedIn: 0 }),
    }));
  }
  // Sample-Fallback: aus den Beispiel-Artikeln (updatedLabel ist dort schon ein String).
  return SAMPLE_ARTICLES.map((a) => ({
    id: a.id,
    title: a.title,
    category: a.category,
    status: a.status,
    views: 0,
    helpfulPct: null,
    usedIn: 0,
    updatedLabel: a.updatedLabel,
    locale: "de",
    articleKey: a.id,
    updatedAt: 0,
  }));
}

/** Einen Artikel zur Bearbeitung laden (jeder Status; D1 oder Sample). */
export async function getArticleForEdit(tenant: Tenant, id: string): Promise<Article | null> {
  const db = await getDbSafe();
  if (db) return new D1ContentRepository(db).getForEdit(tenant.id, id, tenant.defaultLocale);
  return SAMPLE_ARTICLES.find((a) => a.id === id || a.slug === id) ?? null;
}

/** Sprachfassungen des Translation-Sets eines Artikels (Editor; Sample: leer). */
export async function listArticleTranslations(
  tenant: Tenant,
  article: Article,
): Promise<ArticleTranslationInfo[]> {
  const db = await getDbSafe();
  if (!db) return [];
  return new D1ContentRepository(db).listTranslations(tenant.id, article.articleKey ?? article.id);
}

/** `groupByCategory` re-exportiert, damit Seiten nicht direkt aufs Fake zugreifen müssen. */
export { groupByCategory };
