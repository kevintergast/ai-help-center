/**
 * Domänen-Typen der Inhalts-/RAG-Schicht (transport-agnostisch).
 * Die UI baut ausschließlich gegen diese Typen. Gelesen wird über die (async)
 * `HelpCenterRepository`, die heute entweder D1 (src/server/content) oder — ohne
 * Cloudflare-Kontext — ein Sample-Fake (src/lib/content/fake-repo.ts) erfüllt.
 * `ask()`/RAG (D1/Vectorize) ist bewusst noch ein Stub (Punkt 3).
 */

export type ArticleStatus = "current" | "stale" | "ai" | "draft";

export interface Citation {
  id: string;
  title: string;
}

export interface ArticleVideo {
  id: string;
  title: string;
  durationLabel: string;
  /**
   * PFLICHT (a11y + KI-Grounding): eine kurze Beschreibung des Videoinhalts.
   * Wird in der UI aktuell nicht separat gerendert, ist aber Pflichtfeld im
   * Storage (videos_json) und wird bei der Validierung erzwungen.
   */
  description: string;
}

export interface ArticleSummary {
  id: string;
  slug: string;
  title: string;
  category: string;
  status: ArticleStatus;
  /** Vorformatiert, z. B. "vor 3 Tagen" — Formatierung ist später Server-/i18n-Sache. */
  updatedLabel: string;
}

export interface Article extends ArticleSummary {
  readingMinutes: number;
  /** Absätze des Artikelkörpers (Rich-Text kommt später). */
  body: string[];
  videos: ArticleVideo[];
  relatedIds: string[];
}

export interface CategoryGroup {
  category: string;
  articles: ArticleSummary[];
}

export interface AskAnswer {
  question: string;
  body: string[];
  citations: Citation[];
  grounded: boolean;
}

export interface RoadmapItem {
  id: string;
  title: string;
  status: "planned" | "in_progress" | "shipped";
}

export interface ChangelogEntry {
  id: string;
  dateLabel: string;
  title: string;
  description: string;
}

/**
 * Öffentlicher Lesezugriff aufs Hilfezentrum (nur veröffentlichte Inhalte).
 * Die Instanz ist bereits auf EINEN Tenant + Locale gebunden (daher keine
 * Parameter) — gebaut über `getHelpCenterRepo(tenant)` (src/server/content).
 *
 * ASYNC: D1 ist asynchron; alle Methoden liefern Promises. Alle Aufrufstellen
 * (Server-Seiten) awaiten. `ask()` (RAG) ist bewusst noch ein Stub (Punkt 3).
 */
export interface HelpCenterRepository {
  listByCategory(): Promise<CategoryGroup[]>;
  searchItems(): Promise<ArticleSummary[]>;
  /** Alle veröffentlichten Artikel als Volltext (für das Client-Bundle: Detail + Verwandte). */
  listArticles(): Promise<Article[]>;
  getArticle(slugOrId: string): Promise<Article | null>;
  ask(question: string): Promise<AskAnswer>;
  roadmap(): Promise<RoadmapItem[]>;
  changelog(): Promise<ChangelogEntry[]>;
  promptSuggestions(): Promise<string[]>;
}

/**
 * Vorab serverseitig aufgelöstes Lese-Bundle fürs Hilfezentrum. Die
 * (Client-)Komponente `HelpCenter` rendert ausschließlich hieraus und macht KEINE
 * eigenen async-Repo-Aufrufe mehr — Detail-/Verwandten-/Quellen-Lookups laufen
 * lokal über `articles`. `ask()` bleibt ein clientseitiger Stub über `articles`
 * (RAG = Punkt 3), bis Vectorize angebunden ist.
 */
export interface HelpCenterData {
  groups: CategoryGroup[];
  searchItems: ArticleSummary[];
  articles: Article[];
  roadmap: RoadmapItem[];
  changelog: ChangelogEntry[];
  suggestions: string[];
}
