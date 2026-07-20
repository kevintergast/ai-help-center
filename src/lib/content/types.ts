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
  /** Quellen-Art (fehlt = "article"; Roadmap/Changelog = Pseudo-Quellen). */
  kind?: "article" | "roadmap" | "changelog";
  /** Artikel-Slug (nur kind article) — fürs Verlinken OHNE Lese-Bundle (Widget-iframe). */
  slug?: string;
}

export interface ArticleVideo {
  id: string;
  title: string;
  /** Anzeige-Label (z. B. "3:20"); leer erlaubt (nicht automatisch ermittelbar). */
  durationLabel: string;
  /**
   * YouTube-Video-ID (11 Zeichen) — v1 der Video-Einbindung ist bewusst NUR
   * YouTube (User-Entscheidung 2026-07-17; Cloudflare Stream später). Es wird
   * NUR die ID gespeichert, nie eine rohe URL — die Embed-URL baut die UI aus
   * der validierten ID (youtube-nocookie). Optional nur für Altbestände;
   * die Validierung erzwingt sie für neue Videos.
   */
  youtubeId?: string;
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

/**
 * Bild eines Artikels (Metadaten; Binärdatei liegt in R2 unter dem aus den
 * Ids ABGELEITETEN Key). `description` ist PFLICHT — sie ist zugleich
 * Alt-Text (a11y) und KI-Kontext (fließt in die Such-Chunks, Architektur).
 */
/** Sprachfassung eines Translation-Sets (Editor/Liste; Staleness via updatedAt). */
export interface ArticleTranslationInfo {
  id: string;
  locale: string;
  slug: string;
  lifecycle: "draft" | "published";
  title: string;
  /** unixepoch — Original neuer als Übersetzung = Übersetzung veraltet. */
  updatedAt: number;
}

export interface ArticleImage {
  id: string;
  description: string;
  /**
   * VORMERKUNG (Import ohne Binärdaten): true = Bild fehlt noch, es existiert
   * nur die Beschreibung. Öffentliche Anzeige und KI-Index ignorieren
   * Vormerkungen; der Editor zeigt sie mit „Jetzt hochladen"-Aktion.
   */
  pending?: boolean;
}

export interface Article extends ArticleSummary {
  readingMinutes: number;
  /** Absätze des Artikelkörpers (Rich-Text kommt später). */
  body: string[];
  videos: ArticleVideo[];
  relatedIds: string[];
  /** Bilder (fehlend = keine — Altbestände/Fakes ohne Feld bleiben gültig). */
  images?: ArticleImage[];
  /** Sprach-/Set-Infos (Translation-Sets; fehlend bei Sample-/Altdaten). */
  locale?: string;
  articleKey?: string;
}

export interface CategoryGroup {
  category: string;
  articles: ArticleSummary[];
}

/**
 * Quell-Referenz einer KI-Antwort: Chunk + Inhalts-Hash zum Zeitpunkt der
 * Generierung — die STALENESS-Basis der Architektur (ändert sich der Hash der
 * Quelle, ist eine gespeicherte Antwort veraltet; Abgleich kommt als eigener
 * Schritt, die Daten werden ab JETZT erfasst).
 */
export interface SourceRef {
  /** Artikel-Id oder Pseudo-Id (`rm:`/`cl:` — Roadmap/Changelog). */
  articleId: string;
  chunkIndex: number;
  contentHash: string;
  /** Quellen-Art (fehlt = "article" — ältere gespeicherte Antworten). */
  kind?: "article" | "roadmap" | "changelog";
}

export interface AskAnswer {
  question: string;
  body: string[];
  citations: Citation[];
  grounded: boolean;
  /** Quell-Chunks der Generierung (leer bei grounded:false). */
  sourceRefs?: SourceRef[];
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
  /** Veröffentlichte Sprachfassungen eines Sets (Sprachumschalter). */
  siblingsOf(articleKey: string): Promise<{ locale: string; slug: string }[]>;
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
