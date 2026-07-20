import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { D1ContentRepository } from "./store";
import type { ArticleInput } from "./validate";

/**
 * REAL-DDL-TESTS (Muster: team-persistence.test.ts): das handgeschriebene SQL des
 * D1ContentRepository läuft gegen die ECHTEN Migrationen (inkl. CHECK/UNIQUE/
 * composite PK aus 0005). Verhinderte reale Fehlerfälle:
 *  - Cross-Tenant-Leak (Artikel eines Tenants im anderen sichtbar),
 *  - Lifecycle-Bruch (Draft öffentlich sichtbar / Publish setzt kein published_at
 *    oder keinen Snapshot),
 *  - Formdrift gegenüber src/lib/content/types.ts.
 */

const MIGRATIONS = [
  "0001_tenants.sql", "0021_tenant_suspend.sql", "0023_logo_dark.sql",
  "0002_auth.sql",
  "0003_branding.sql",
  "0004_two_factor_plugin_columns.sql",
  "0005_content.sql", "0018_article_images.sql", "0019_article_translations.sql",
] as const;

const T1 = "t_one";
const T2 = "t_two";
const LOCALE = "de";

function makeInput(over: Partial<ArticleInput> = {}): ArticleInput {
  return {
    slug: "konto-einrichten",
    title: "Konto einrichten",
    category: "Erste Schritte",
    locale: LOCALE,
    body: ["Absatz eins.", "Absatz zwei."],
    videos: [
      { id: "v1", title: "Rundgang", durationLabel: "1:30", description: "Kurzer Rundgang." },
    ],
    relatedIds: [],
    readingMinutes: 4,
    isAiGenerated: false,
    ...over,
  };
}

describe("D1ContentRepository gegen die echten Migrationen (D1-Shim über better-sqlite3)", () => {
  let db: Database.Database;
  let repo: D1ContentRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db, MIGRATIONS);
    db.prepare("INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)").run(T1, "one", "One");
    db.prepare("INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)").run(T2, "two", "Two");
    repo = new D1ContentRepository(d1FromSqlite(db));
  });
  afterEach(() => db.close());

  describe("Lifecycle: nur published ist öffentlich", () => {
    it("Draft ist nicht öffentlich (listByCategory/searchItems/getBySlug leer), aber in Admin-Zeilen", async () => {
      const id = await repo.create(T1, makeInput());

      expect(await repo.listByCategory(T1, LOCALE)).toEqual([]);
      expect(await repo.searchItems(T1, LOCALE)).toEqual([]);
      expect(await repo.getPublishedArticleBySlugOrId(T1, LOCALE, "konto-einrichten")).toBeNull();

      const rows = await repo.listAdminRows(T1, LOCALE);
      expect(rows.map((r) => r.id)).toEqual([id]);
      expect(rows[0].status).toBe("draft");
      // Analytics sind Platzhalter (P5), nicht erfunden.
      expect(rows[0]).toMatchObject({ views: 0, helpfulPct: null, usedIn: 0 });
    });

    it("publish macht sichtbar, setzt published_at UND schreibt einen Version-Snapshot", async () => {
      const id = await repo.create(T1, makeInput());

      expect(await repo.publish(T1, id, "author-1")).toBe(true);

      const bySlug = await repo.getPublishedArticleBySlugOrId(T1, LOCALE, "konto-einrichten");
      expect(bySlug?.id).toBe(id);
      expect((await repo.searchItems(T1, LOCALE)).map((a) => a.id)).toEqual([id]);

      const row = db
        .prepare("SELECT status, published_at FROM articles WHERE tenant_id = ? AND id = ?")
        .get(T1, id) as { status: string; published_at: number | null };
      expect(row.status).toBe("published");
      expect(row.published_at).toBeGreaterThan(0);

      const snaps = db
        .prepare("SELECT author_id FROM article_versions WHERE tenant_id = ? AND article_id = ?")
        .all(T1, id) as { author_id: string | null }[];
      expect(snaps.length).toBe(1);
      expect(snaps[0].author_id).toBe("author-1");
    });

    it("unpublish nimmt den Artikel wieder aus dem Public-Read", async () => {
      const id = await repo.create(T1, makeInput());
      await repo.publish(T1, id);
      expect((await repo.searchItems(T1, LOCALE)).length).toBe(1);

      expect(await repo.unpublish(T1, id)).toBe(true);
      expect(await repo.searchItems(T1, LOCALE)).toEqual([]);
    });

    it("update erzeugt einen Snapshot und ändert die Felder", async () => {
      const id = await repo.create(T1, makeInput());
      expect(await repo.update(T1, id, { title: "Neuer Titel", body: ["nur ein Absatz"] })).toBe(true);

      const article = await repo.getForEdit(T1, id, LOCALE);
      expect(article?.title).toBe("Neuer Titel");
      expect(article?.body).toEqual(["nur ein Absatz"]);

      const snaps = db
        .prepare("SELECT COUNT(*) AS n FROM article_versions WHERE tenant_id = ? AND article_id = ?")
        .get(T1, id) as { n: number };
      expect(snaps.n).toBe(1);
    });

    it("publish/update/remove auf unbekannter ID → false (kein Treffer)", async () => {
      expect(await repo.publish(T1, "nope")).toBe(false);
      expect(await repo.update(T1, "nope", { title: "x" })).toBe(false);
      expect(await repo.unpublish(T1, "nope")).toBe(false);
      expect(await repo.remove(T1, "nope")).toBe(false);
    });
  });

  describe("Tenant-Isolation", () => {
    it("veröffentlichter Artikel aus t_one ist in t_two unsichtbar (public UND admin)", async () => {
      const id = await repo.create(T1, makeInput());
      await repo.publish(T1, id);

      // Public in t_two: nichts.
      expect(await repo.searchItems(T2, LOCALE)).toEqual([]);
      expect(await repo.listByCategory(T2, LOCALE)).toEqual([]);
      expect(await repo.getPublishedArticleBySlugOrId(T2, LOCALE, "konto-einrichten")).toBeNull();
      // Admin in t_two: nichts; getForEdit über fremden Tenant → null.
      expect(await repo.listAdminRows(T2, LOCALE)).toEqual([]);
      expect(await repo.getForEdit(T2, id, LOCALE)).toBeNull();

      // In t_one dagegen sichtbar.
      expect((await repo.searchItems(T1, LOCALE)).map((a) => a.id)).toEqual([id]);
    });

    it("gleicher Slug in beiden Tenants erlaubt (Unique ist tenant-/locale-scoped)", async () => {
      await repo.create(T1, makeInput({ slug: "gleicher-slug" }));
      // Darf NICHT werfen — Slug-Unique gilt nur je (tenant_id, locale).
      await expect(repo.create(T2, makeInput({ slug: "gleicher-slug" }))).resolves.toBeTruthy();
    });

    it("doppelter Slug im selben Tenant/Locale wirft (uq_articles_slug)", async () => {
      await repo.create(T1, makeInput({ slug: "dup" }));
      await expect(repo.create(T1, makeInput({ slug: "dup" }))).rejects.toThrow();
    });
  });

  describe("Formen entsprechen types.ts", () => {
    it("Article trägt body/videos(+description)/relatedIds/updatedLabel/status", async () => {
      const id = await repo.create(
        T1,
        makeInput({ relatedIds: ["other"], isAiGenerated: true }),
      );
      await repo.publish(T1, id);

      const a = await repo.getPublishedArticleBySlugOrId(T1, LOCALE, id);
      expect(a).toMatchObject({
        id,
        slug: "konto-einrichten",
        title: "Konto einrichten",
        category: "Erste Schritte",
        status: "ai", // published + is_ai_generated
        readingMinutes: 4,
        body: ["Absatz eins.", "Absatz zwei."],
        relatedIds: ["other"],
      });
      expect(a?.videos[0]).toMatchObject({ id: "v1", description: "Kurzer Rundgang." });
      expect(typeof a?.updatedLabel).toBe("string");
      expect(a?.updatedLabel.length).toBeGreaterThan(0);
    });

    it("listByCategory gruppiert published nach Kategorie (Reihenfolge des ersten Auftretens)", async () => {
      const a = await repo.create(T1, makeInput({ slug: "a", category: "Erste Schritte" }));
      const b = await repo.create(T1, makeInput({ slug: "b", category: "Integration" }));
      const cId = await repo.create(T1, makeInput({ slug: "c", category: "Erste Schritte" }));
      for (const id of [a, b, cId]) await repo.publish(T1, id);

      const groups = await repo.listByCategory(T1, LOCALE);
      expect(groups.map((g) => g.category)).toEqual(["Erste Schritte", "Integration"]);
      expect(groups[0].articles.length).toBe(2);
      expect(groups[1].articles.length).toBe(1);
    });
  });
});
