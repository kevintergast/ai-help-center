/**
 * Domänen-Typen der Inhalts-/RAG-Schicht (transport-agnostisch).
 * Die UI baut ausschließlich gegen diese Typen; heute liefert sie ein Fake
 * (src/lib/content/fake-repo.ts), später `/api/v1/articles` + `/ask` (D1/Vectorize).
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

/** Minimaler Lesezugriff aufs Hilfezentrum — implementiert vom Fake und später vom API-Client. */
export interface HelpCenterRepository {
  listByCategory(): CategoryGroup[];
  searchItems(): ArticleSummary[];
  getArticle(id: string): Article | null;
  ask(question: string): AskAnswer;
  roadmap(): RoadmapItem[];
  changelog(): ChangelogEntry[];
  promptSuggestions(): string[];
}
