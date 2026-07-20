import type { AdminArticleRow } from "@/lib/admin/types";
import type {
  Article,
  ArticleImage,
  ArticleStatus,
  ArticleSummary,
  CategoryGroup,
  ChangelogEntry,
  RoadmapItem,
} from "@/lib/content/types";
import { groupByCategory } from "@/lib/content/fake-repo";
import type { ArticleInput, ArticleUpdateInput } from "./validate";

/**
 * Persistenz fürs Content-Backend (`articles` / `article_versions` /
 * `roadmap_items` / `changelog_entries`). Muster: branding/store.ts + legal/store.ts.
 *
 * ISOLATIONS-INVARIANTE: JEDE Query ist über `WHERE tenant_id = ?` gebunden; die
 * Tenant-ID kommt IMMER aus der Host-Auflösung (`c.get("tenant").id`), niemals aus
 * Param/Body/Query. Der öffentliche Lesepfad filtert zusätzlich hart auf
 * `status = 'published'` (Lifecycle-Regel: nur Veröffentlichtes ist sichtbar und
 * später RAG-fähig).
 *
 * STATUS-MAPPING Storage → Anzeige (types ArticleStatus):
 *   published + is_ai_generated → "ai"   |  published → "current"
 *   draft → "draft"                       |  archived → "draft" (reserviert; kein
 *   MVP-Endpoint erzeugt 'archived'). "stale" (zeitbasiert) kommt mit P5/Analytics.
 */
export interface ContentStore {
  // ——— Öffentlich (nur status='published') ———
  listByCategory(tenantId: string, locale: string): Promise<CategoryGroup[]>;
  searchItems(tenantId: string, locale: string): Promise<ArticleSummary[]>;
  listPublishedArticles(tenantId: string, locale: string): Promise<Article[]>;
  getPublishedArticleBySlugOrId(
    tenantId: string,
    locale: string,
    key: string,
  ): Promise<Article | null>;
  roadmap(tenantId: string): Promise<RoadmapItem[]>;
  changelog(tenantId: string, locale: string): Promise<ChangelogEntry[]>;

  // ——— Admin (alle Status) ———
  listAdminRows(tenantId: string, locale: string): Promise<AdminArticleRow[]>;
  /** Vollbestand für den Export (alle Status, inkl. Artikel-locale). */
  listForTransfer(tenantId: string): Promise<TransferArticle[]>;
  getForEdit(tenantId: string, id: string, locale: string): Promise<Article | null>;
  /** `articleKey` verbindet Sprachfassungen (fehlt → neues Set = eigene id). */
  create(tenantId: string, input: ArticleInput, articleKey?: string): Promise<string>;
  update(tenantId: string, id: string, input: ArticleUpdateInput, authorId?: string | null): Promise<boolean>;
  publish(tenantId: string, id: string, authorId?: string | null): Promise<boolean>;
  unpublish(tenantId: string, id: string): Promise<boolean>;
  remove(tenantId: string, id: string): Promise<boolean>;

  // ——— Übersetzungen (Translation-Sets über article_key) ———
  /** Alle Sprachfassungen eines Sets (Admin, alle Status). */
  listTranslations(
    tenantId: string,
    articleKey: string,
  ): Promise<{ id: string; locale: string; slug: string; lifecycle: "draft" | "published" }[]>;
  /** VERÖFFENTLICHTE Geschwister-Fassungen (Sprachumschalter, public). */
  getPublishedSiblings(
    tenantId: string,
    articleKey: string,
  ): Promise<{ locale: string; slug: string }[]>;

  // ——— Bilder (Metadaten; Binärdaten in R2, Key aus Ids abgeleitet) ———
  addImage(tenantId: string, articleId: string, image: ArticleImage): Promise<"ok" | "not_found" | "limit">;
  removeImage(tenantId: string, articleId: string, imageId: string): Promise<boolean>;
  /** NUR veröffentlichte Artikel (public Serving, fail-closed für Drafts). */
  getPublishedImage(
    tenantId: string,
    articleKey: string,
    imageId: string,
  ): Promise<{ articleId: string; image: ArticleImage } | null>;
}

/** Max. Bilder je Artikel (Speicher-/UI-Deckel). */
export const MAX_IMAGES_PER_ARTICLE = 12;

/**
 * Struktur-kompatibel zum R2-Bucket (MEDIA-Binding) — Fakes in Tests. Nur die
 * drei benötigten Operationen (kein list: Keys werden IMMER abgeleitet).
 */
export interface ArticleMediaBucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
  } | null>;
  delete(key: string): Promise<void>;
}

/** R2-Key eines Artikel-Bilds — IMMER abgeleitet, nie gespeichert/aus Client-Input. */
export function articleImageKey(tenantId: string, articleId: string, imageId: string): string {
  return `tenants/${tenantId}/articles/${articleId}/${imageId}`;
}

/** Pro Request aufgelöste Content-Infrastruktur (`null` = D1-Binding fehlt → 503). */
export interface ContentDeps {
  store: ContentStore;
  /** R2 (MEDIA) für Artikel-Bilder; null = Binding fehlt → Upload/Serving 503. */
  media: ArticleMediaBucket | null;
}

/** Export-Zeile: Artikel + eigene locale + ROHER Lifecycle-Status. */
export type TransferArticle = Article & {
  locale: string;
  lifecycle: "draft" | "published";
};

/* ————— Anzeige-Formatierung (i18n über Intl, keine hartkodierten Sprach-Strings) ————— */

/** Relatives Zeit-Label ("vor 3 Tagen" / "3 days ago") via Intl.RelativeTimeFormat. */
export function relativeTimeLabel(updatedAtSec: number, locale: string, nowMs = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diffSec = Math.round(updatedAtSec - nowMs / 1000); // Vergangenheit ⇒ negativ
  const abs = Math.abs(diffSec);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs) return rtf.format(Math.round(diffSec / secs), unit);
  }
  return rtf.format(Math.round(diffSec), "second");
}

/** Absolutes Datum-Label ("8. Juli 2026" / "July 8, 2026") via Intl.DateTimeFormat. */
export function dateLabel(publishedAtSec: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(publishedAtSec * 1000));
}

/* ————— D1-Zeile → Domänentyp ————— */

interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  category: string;
  status: string;
  locale: string;
  article_key: string;
  body_json: string;
  videos_json: string;
  related_ids_json: string;
  images_json: string;
  reading_minutes: number;
  is_ai_generated: number;
  updated_at: number;
}

function displayStatus(status: string, isAi: number): ArticleStatus {
  if (status === "published") return isAi ? "ai" : "current";
  // 'archived' ist reserviert (kein MVP-Endpoint) → als "draft" ausgeblendet.
  return "draft";
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function rowToArticle(row: ArticleRow, locale: string): Article {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    status: displayStatus(row.status, row.is_ai_generated),
    updatedLabel: relativeTimeLabel(row.updated_at, locale),
    readingMinutes: row.reading_minutes,
    body: parseJsonArray<string>(row.body_json),
    videos: parseJsonArray<Article["videos"][number]>(row.videos_json),
    relatedIds: parseJsonArray<string>(row.related_ids_json),
    images: parseJsonArray<ArticleImage>(row.images_json).filter(
      (i) => typeof i?.id === "string" && typeof i?.description === "string",
    ),
    locale: row.locale,
    articleKey: row.article_key,
  };
}

function rowToSummary(row: ArticleRow, locale: string): ArticleSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    status: displayStatus(row.status, row.is_ai_generated),
    updatedLabel: relativeTimeLabel(row.updated_at, locale),
  };
}

const ARTICLE_COLS =
  "id, slug, title, category, status, locale, article_key, body_json, videos_json, related_ids_json, images_json, reading_minutes, is_ai_generated, updated_at";

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/**
 * Der Slug ist je (tenant_id, locale) eindeutig (uq_articles_slug, 0005). Ein
 * Duplikat ist ein ERWARTETER, client-korrigierbarer Fehler — kein Serverfehler.
 * `create` fängt die UNIQUE-Verletzung und wirft diesen typisierten Fehler,
 * damit der Router ihn auf `409 slug_conflict` abbilden kann (statt 500).
 */
export class SlugConflictError extends Error {
  constructor() {
    super("Article slug already exists for this tenant/locale (unique constraint).");
    this.name = "SlugConflictError";
  }
}

/**
 * Erkennt eine SQLite/D1-UNIQUE-Verletzung anhand der (bei beiden identischen)
 * Fehlermeldung ("UNIQUE constraint failed: ..."). Auf `articles` ist der einzige
 * UNIQUE-Index `uq_articles_slug` → beim Insert ist jede UNIQUE-Verletzung der Slug.
 */
function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /unique constraint failed/i.test(msg);
}

/** D1-Implementierung — jede Query ist über `WHERE tenant_id = ?` tenant-gebunden. */
export class D1ContentRepository implements ContentStore {
  constructor(private readonly db: D1Database) {}

  // ——— Öffentlich ———

  async listPublishedArticles(tenantId: string, locale: string): Promise<Article[]> {
    // locale-Filter: Listen/Suche zeigen die Anzeige-Sprache des Tenants;
    // ÜBERSETZUNGEN bleiben über ihren eigenen Slug + Sprachumschalter
    // erreichbar (getPublishedArticleBySlugOrId filtert bewusst NICHT).
    const { results } = await this.db
      .prepare(
        `SELECT ${ARTICLE_COLS} FROM articles
          WHERE tenant_id = ? AND status = 'published' AND locale = ?
          ORDER BY created_at ASC`,
      )
      .bind(tenantId, locale)
      .all<ArticleRow>();
    return results.map((r) => rowToArticle(r, locale));
  }

  async listByCategory(tenantId: string, locale: string): Promise<CategoryGroup[]> {
    return groupByCategory(await this.listPublishedArticles(tenantId, locale));
  }

  async searchItems(tenantId: string, locale: string): Promise<ArticleSummary[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${ARTICLE_COLS} FROM articles
          WHERE tenant_id = ? AND status = 'published' AND locale = ?
          ORDER BY created_at ASC`,
      )
      .bind(tenantId, locale)
      .all<ArticleRow>();
    return results.map((r) => rowToSummary(r, locale));
  }

  async getPublishedArticleBySlugOrId(
    tenantId: string,
    locale: string,
    key: string,
  ): Promise<Article | null> {
    const row = await this.db
      .prepare(
        `SELECT ${ARTICLE_COLS} FROM articles
          WHERE tenant_id = ? AND status = 'published' AND (id = ? OR slug = ?)
          ORDER BY (locale = ?) DESC
          LIMIT 1`,
      )
      .bind(tenantId, key, key, locale)
      .first<ArticleRow>();
    return row ? rowToArticle(row, locale) : null;
  }

  async roadmap(tenantId: string): Promise<RoadmapItem[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, title, status FROM roadmap_items
          WHERE tenant_id = ? ORDER BY sort ASC, created_at ASC`,
      )
      .bind(tenantId)
      .all<{ id: string; title: string; status: RoadmapItem["status"] }>();
    return results.map((r) => ({ id: r.id, title: r.title, status: r.status }));
  }

  async changelog(tenantId: string, locale: string): Promise<ChangelogEntry[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, published_at, title, description FROM changelog_entries
          WHERE tenant_id = ? ORDER BY published_at DESC`,
      )
      .bind(tenantId)
      .all<{ id: string; published_at: number; title: string; description: string }>();
    return results.map((r) => ({
      id: r.id,
      dateLabel: dateLabel(r.published_at, locale),
      title: r.title,
      description: r.description,
    }));
  }

  // ——— Admin ———

  async listAdminRows(tenantId: string, locale: string): Promise<AdminArticleRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${ARTICLE_COLS} FROM articles
          WHERE tenant_id = ? ORDER BY updated_at DESC`,
      )
      .bind(tenantId)
      .all<ArticleRow>();
    // views/helpfulPct/usedIn: Basiswerte — die echten usage_events-Aggregate
    // joint listAdminArticleRows (content/runtime.ts) über den Billing-Store.
    return results.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      status: displayStatus(r.status, r.is_ai_generated),
      views: 0,
      helpfulPct: null,
      usedIn: 0,
      updatedLabel: relativeTimeLabel(r.updated_at, locale),
    }));
  }

  async listForTransfer(tenantId: string): Promise<TransferArticle[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${ARTICLE_COLS} FROM articles
          WHERE tenant_id = ? ORDER BY created_at ASC`,
      )
      .bind(tenantId)
      .all<ArticleRow & { locale: string }>();
    // Anzeige-Labels sind hier egal (Transfer-Daten) → Artikel-locale reicht.
    // `lifecycle` = ROHER DB-Status ("draft"|"published") — Article.status ist
    // der ANZEIGE-Status (current/ai/…) und für den Transfer ungeeignet.
    return results.map((r) => ({
      ...rowToArticle(r, r.locale),
      locale: r.locale,
      lifecycle: r.status === "published" ? ("published" as const) : ("draft" as const),
    }));
  }

  async getForEdit(tenantId: string, id: string, locale: string): Promise<Article | null> {
    const row = await this.db
      .prepare(`SELECT ${ARTICLE_COLS} FROM articles WHERE tenant_id = ? AND id = ? LIMIT 1`)
      .bind(tenantId, id)
      .first<ArticleRow>();
    return row ? rowToArticle(row, locale) : null;
  }

  async create(tenantId: string, input: ArticleInput, articleKey?: string): Promise<string> {
    const id = newId("art");
    try {
      await this.db
        .prepare(
          `INSERT INTO articles
           (id, tenant_id, locale, article_key, slug, title, category, status,
            body_json, videos_json, related_ids_json, reading_minutes, is_ai_generated)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          tenantId,
          input.locale,
          articleKey ?? id,
          input.slug,
          input.title,
          input.category,
          JSON.stringify(input.body),
          JSON.stringify(input.videos),
          JSON.stringify(input.relatedIds),
          input.readingMinutes,
          input.isAiGenerated ? 1 : 0,
        )
        .run();
    } catch (err) {
      // Duplikat-Slug (uq_articles_slug) → typisierter Fehler → Router: 409.
      if (isUniqueViolation(err)) throw new SlugConflictError();
      throw err;
    }
    return id;
  }

  async update(
    tenantId: string,
    id: string,
    input: ArticleUpdateInput,
    authorId: string | null = null,
  ): Promise<boolean> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => {
      sets.push(`${col} = ?`);
      params.push(val);
    };
    if (input.title !== undefined) push("title", input.title);
    if (input.category !== undefined) push("category", input.category);
    if (input.body !== undefined) push("body_json", JSON.stringify(input.body));
    if (input.videos !== undefined) push("videos_json", JSON.stringify(input.videos));
    if (input.relatedIds !== undefined) push("related_ids_json", JSON.stringify(input.relatedIds));
    if (input.readingMinutes !== undefined) push("reading_minutes", input.readingMinutes);
    if (input.isAiGenerated !== undefined) push("is_ai_generated", input.isAiGenerated ? 1 : 0);
    sets.push("updated_at = unixepoch()");

    const res = await this.db
      .prepare(`UPDATE articles SET ${sets.join(", ")} WHERE tenant_id = ? AND id = ?`)
      .bind(...params, tenantId, id)
      .run();
    if (res.meta.changes === 0) return false;

    await this.snapshot(tenantId, id, authorId);
    return true;
  }

  async publish(tenantId: string, id: string, authorId: string | null = null): Promise<boolean> {
    // Erst-Publish setzt published_at; ein späterer Re-Publish behält es (COALESCE).
    const res = await this.db
      .prepare(
        `UPDATE articles
            SET status = 'published',
                published_at = COALESCE(published_at, unixepoch()),
                updated_at = unixepoch()
          WHERE tenant_id = ? AND id = ?`,
      )
      .bind(tenantId, id)
      .run();
    if (res.meta.changes === 0) return false;

    await this.snapshot(tenantId, id, authorId);
    return true;
  }

  async unpublish(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE articles SET status = 'draft', updated_at = unixepoch()
          WHERE tenant_id = ? AND id = ?`,
      )
      .bind(tenantId, id)
      .run();
    return res.meta.changes > 0;
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    // Versionen defensiv mitlöschen (FK-CASCADE ist in D1 nicht garantiert aktiv).
    await this.db
      .prepare(`DELETE FROM article_versions WHERE tenant_id = ? AND article_id = ?`)
      .bind(tenantId, id)
      .run();
    const res = await this.db
      .prepare(`DELETE FROM articles WHERE tenant_id = ? AND id = ?`)
      .bind(tenantId, id)
      .run();
    return res.meta.changes > 0;
  }

  // ——— Übersetzungen ———

  async listTranslations(
    tenantId: string,
    articleKey: string,
  ): Promise<{ id: string; locale: string; slug: string; lifecycle: "draft" | "published" }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, locale, slug, status FROM articles
          WHERE tenant_id = ? AND article_key = ? ORDER BY created_at ASC`,
      )
      .bind(tenantId, articleKey)
      .all<{ id: string; locale: string; slug: string; status: string }>();
    return results.map((r) => ({
      id: r.id,
      locale: r.locale,
      slug: r.slug,
      lifecycle: r.status === "published" ? "published" : "draft",
    }));
  }

  async getPublishedSiblings(
    tenantId: string,
    articleKey: string,
  ): Promise<{ locale: string; slug: string }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT locale, slug FROM articles
          WHERE tenant_id = ? AND article_key = ? AND status = 'published'
          ORDER BY locale ASC`,
      )
      .bind(tenantId, articleKey)
      .all<{ locale: string; slug: string }>();
    return results;
  }

  // ——— Bilder ———

  async addImage(
    tenantId: string,
    articleId: string,
    image: ArticleImage,
  ): Promise<"ok" | "not_found" | "limit"> {
    const row = await this.db
      .prepare(`SELECT images_json FROM articles WHERE tenant_id = ? AND id = ?`)
      .bind(tenantId, articleId)
      .first<{ images_json: string }>();
    if (!row) return "not_found";

    const images = parseJsonArray<ArticleImage>(row.images_json);
    if (images.length >= MAX_IMAGES_PER_ARTICLE) return "limit";
    images.push(image);

    await this.db
      .prepare(
        `UPDATE articles SET images_json = ?, updated_at = unixepoch()
          WHERE tenant_id = ? AND id = ?`,
      )
      .bind(JSON.stringify(images), tenantId, articleId)
      .run();
    return "ok";
  }

  async removeImage(tenantId: string, articleId: string, imageId: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT images_json FROM articles WHERE tenant_id = ? AND id = ?`)
      .bind(tenantId, articleId)
      .first<{ images_json: string }>();
    if (!row) return false;

    const images = parseJsonArray<ArticleImage>(row.images_json);
    const remaining = images.filter((i) => i.id !== imageId);
    if (remaining.length === images.length) return false;

    await this.db
      .prepare(
        `UPDATE articles SET images_json = ?, updated_at = unixepoch()
          WHERE tenant_id = ? AND id = ?`,
      )
      .bind(JSON.stringify(remaining), tenantId, articleId)
      .run();
    return true;
  }

  async getPublishedImage(
    tenantId: string,
    articleKey: string,
    imageId: string,
  ): Promise<{ articleId: string; image: ArticleImage } | null> {
    const row = await this.db
      .prepare(
        `SELECT id, images_json FROM articles
          WHERE tenant_id = ? AND status = 'published' AND (id = ? OR slug = ?)
          LIMIT 1`,
      )
      .bind(tenantId, articleKey, articleKey)
      .first<{ id: string; images_json: string }>();
    if (!row) return null;
    const image = parseJsonArray<ArticleImage>(row.images_json).find((i) => i.id === imageId);
    return image ? { articleId: row.id, image } : null;
  }

  /** Aktuellen Artikelstand als JSON-Snapshot einfrieren (Audit/Rollback-Basis). */
  private async snapshot(tenantId: string, articleId: string, authorId: string | null): Promise<void> {
    const row = await this.db
      .prepare(`SELECT ${ARTICLE_COLS}, published_at FROM articles WHERE tenant_id = ? AND id = ?`)
      .bind(tenantId, articleId)
      .first<Record<string, unknown>>();
    if (!row) return;
    await this.db
      .prepare(
        `INSERT INTO article_versions (id, tenant_id, article_id, snapshot_json, author_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(newId("ver"), tenantId, articleId, JSON.stringify(row), authorId)
      .run();
  }
}
