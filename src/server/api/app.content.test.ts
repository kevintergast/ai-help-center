import Database from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { D1ContentRepository } from "@/server/content/store";
import { buildApiApp } from "./app";
import type { BillingDeps } from "@/server/billing/store";
import type { TranslateArticleInput, TranslateArticleResult } from "@/server/content/translate";
import type { ApiDeps } from "./context";

/**
 * CONTENT-ADMIN-API end-to-end über `app.request()`. Auth ist Memory-better-auth
 * (wie app.legal.test.ts); der Content-Store ist der ECHTE D1ContentRepository
 * über einen sqlite-Shim (echtes SQL, echte Migrations-DDL) — keine echten
 * Cloudflare-Bindings. Prüft: Rollen-Gating (requireTeam("content")),
 * Validierung (Video ohne description, ungültiger Slug), Tenant-Scope,
 * Lifecycle (create → draft, publish → sichtbar) und 503 ohne Binding.
 */

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";
const PASSWORD = "correct-horse-battery";
const HOST_A = "tenant-a.hallofhelp.com";
const HOST_B = "tenant-b.hallofhelp.com";

const MIGRATIONS = [
  "0001_tenants.sql",
  "0002_auth.sql",
  "0003_branding.sql",
  "0004_two_factor_plugin_columns.sql",
  "0005_content.sql", "0018_article_images.sql", "0019_article_translations.sql",
] as const;

function makeTenant(id: string, slug: string): Tenant {
  return {
    id,
    slug,
    name: slug,
    customDomain: null,
    defaultLocale: "de",
    branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
  };
}

const TENANTS: Record<string, Tenant> = {
  [HOST_A]: makeTenant("t_a", "tenant-a"),
  [HOST_B]: makeTenant("t_b", "tenant-b"),
};

type MemoryDb = Record<string, Record<string, unknown>[]>;

function makeApp(
  contentAvailable = true,
  opts: { translator?: (input: TranslateArticleInput) => Promise<TranslateArticleResult> } = {},
) {
  const authDb: MemoryDb = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };

  const contentDb = new Database(":memory:");
  applyMigrations(contentDb, MIGRATIONS);
  contentDb.prepare("INSERT INTO tenants (id, slug, name) VALUES ('t_a','tenant-a','A')").run();
  contentDb.prepare("INSERT INTO tenants (id, slug, name) VALUES ('t_b','tenant-b','B')").run();
  const store = new D1ContentRepository(d1FromSqlite(contentDb));

  // Map-Fake des R2-MEDIA-Buckets (Bilder): Struktur wie ArticleMediaBucket.
  const mediaObjects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const media = {
    put: async (
      key: string,
      value: ArrayBuffer | Uint8Array,
      options?: { httpMetadata?: { contentType?: string } },
    ) => {
      mediaObjects.set(key, {
        bytes: value instanceof Uint8Array ? value : new Uint8Array(value),
        contentType: options?.httpMetadata?.contentType,
      });
    },
    get: async (key: string) => {
      const obj = mediaObjects.get(key);
      if (!obj) return null;
      return {
        body: new Blob([obj.bytes as unknown as BlobPart]).stream(),
        httpMetadata: { contentType: obj.contentType },
      };
    },
    delete: async (key: string) => {
      mediaObjects.delete(key);
    },
  };

  // Recorder-Fake des Such-Indexers (Infra-Plan Schritt 6): beweist, dass die
  // Lifecycle-Routen den Index-Sync anstoßen (Logik selbst: indexer.test.ts).
  const indexCalls: { tenantId: string; articleId: string }[] = [];

  // Recorder für KI-Übersetzungs-Verbuchungen (Betrag prüft pricing/creditsFor).
  // getPlanRow/getUsage: aktiver Free-Plan — das Freeze-Gate (POST /admin/*)
  // liest beide bei JEDEM Mutations-Request über readPlanState.
  const translationCharges: { tenantId: string; articleId: string }[] = [];
  const billingRepo = {
    recordAiTranslation: async (input: { tenantId: string; articleId: string }) => {
      translationCharges.push({ tenantId: input.tenantId, articleId: input.articleId });
      return {} as never;
    },
    getPlanRow: async () => ({ plan: "free" as const, overLimitSince: null }),
    getUsage: async () => ({ creditsUsed: 0, mauCount: 0 }),
  };
  const deps: ApiDeps = {
    resolveTenant: async (host) => TENANTS[(host ?? "").split(":")[0].toLowerCase()] ?? null,
    createAuthForTenant: async () =>
      buildAuth({ adapter: memoryAdapter(authDb)(tenantAuthOptions(TEST_SECRET)), secret: TEST_SECRET }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => (contentAvailable ? { store, media } : null),
    getContentIndexer: async () => ({
      onContentChange: async (tenantId, articleId) => {
        indexCalls.push({ tenantId, articleId });
      },
      rebuildTenant: async () => ({ articles: 0, chunks: 0, embedded: 0 }),
    }),
    ...(opts.translator ? { getTranslator: async () => opts.translator ?? null } : {}),
    getBillingDeps: async () => ({ repo: billingRepo as unknown as BillingDeps["repo"] }),
  };
  return {
    app: buildApiApp(deps),
    authDb,
    contentDb,
    store,
    indexCalls,
    mediaObjects,
    translationCharges,
  };
}

type TestApp = ReturnType<typeof makeApp>["app"];

function postJson(app: TestApp, path: string, host: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: "POST",
    headers: { host, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function createSession(
  app: TestApp,
  db: MemoryDb,
  host: string,
  email: string,
  opts: { role?: string; mfa?: boolean } = {},
): Promise<string> {
  const tenantId = TENANTS[host].id;
  const signUp = await postJson(app, `${AUTH_BASE_PATH}/sign-up/email`, host, {
    email,
    password: PASSWORD,
    name: "Test",
  });
  expect(signUp.status).toBe(200);

  const user = db.auth_user.find((u) => u.email === email && u.tenant_id === tenantId);
  user!.email_verified = true;
  if (opts.role) user!.role = opts.role;

  const signIn = await postJson(app, `${AUTH_BASE_PATH}/sign-in/email`, host, {
    email,
    password: PASSWORD,
  });
  expect(signIn.status).toBe(200);

  if (opts.mfa) {
    user!.two_factor_enabled = true;
    const session = db.auth_session.filter((s) => s.user_id === user!.id).at(-1);
    session!.mfa_verified = true;
  }

  return signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const sessionAs = (app: TestApp, db: MemoryDb, host: string, role: string) =>
  createSession(app, db, host, `${role}-${host}@example.com`, { role, mfa: true });

const VALID_ARTICLE = {
  slug: "konto-einrichten",
  title: "Konto einrichten",
  category: "Erste Schritte",
  body: ["Absatz eins."],
};

describe("POST /api/v1/admin/articles (create-Gating)", () => {
  it("ohne Session → 401; als user (mfa, aber < content) → 403; als content → 201", async () => {
    const { app, authDb } = makeApp();

    const anon = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE);
    expect(anon.status).toBe(401);

    const userCookie = await sessionAs(app, authDb, HOST_A, "user");
    const asUser = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, userCookie);
    expect(asUser.status).toBe(403);
    expect(await asUser.json()).toMatchObject({ error: "forbidden" });

    const contentCookie = await sessionAs(app, authDb, HOST_A, "content");
    const asContent = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, contentCookie);
    expect(asContent.status).toBe(201);
    expect(await asContent.json()).toMatchObject({ ok: true });
  });

  it("Validierung: Video ohne description → 400; ungültiger Slug → 400", async () => {
    const { app, authDb } = makeApp();
    const cookie = await sessionAs(app, authDb, HOST_A, "content");

    const noDesc = await postJson(app, "/api/v1/admin/articles", HOST_A, {
      ...VALID_ARTICLE,
      videos: [{ id: "v1", title: "Clip", durationLabel: "1:00" }],
    }, cookie);
    expect(noDesc.status).toBe(400);
    expect(await noDesc.json()).toMatchObject({ error: "video_description_required" });

    const badSlug = await postJson(app, "/api/v1/admin/articles", HOST_A, {
      ...VALID_ARTICLE,
      slug: "Ungültig Slug!",
    }, cookie);
    expect(badSlug.status).toBe(400);
    expect(await badSlug.json()).toMatchObject({ error: "invalid_slug" });
  });

  it("fehlendes D1-Binding → 503 fail-closed", async () => {
    const { app, authDb } = makeApp(false);
    const cookie = await sessionAs(app, authDb, HOST_A, "content");
    const res = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, cookie);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "content_unavailable" });
  });

  it("Slug-Kollision (je tenant/locale eindeutig) → 409 slug_conflict, nicht 500", async () => {
    const { app, authDb } = makeApp();
    const cookie = await sessionAs(app, authDb, HOST_A, "content");

    const first = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, cookie);
    expect(first.status).toBe(201);

    const dup = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, cookie);
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "slug_conflict" });
  });
});

describe("Lifecycle + Tenant-Scope über die API", () => {
  it("create → draft (nicht public); publish → im Store veröffentlicht", async () => {
    const { app, authDb, store } = makeApp();
    const cookie = await sessionAs(app, authDb, HOST_A, "content");

    const created = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, cookie);
    const { id } = (await created.json()) as { id: string };

    // Direkt nach create: Draft → nicht im Public-Read.
    expect(await store.searchItems("t_a", "de")).toEqual([]);

    const pub = await postJson(app, `/api/v1/admin/articles/${id}/publish`, HOST_A, {}, cookie);
    expect(pub.status).toBe(200);
    expect((await store.searchItems("t_a", "de")).map((a) => a.id)).toEqual([id]);
  });

  it("Artikel aus t_a ist über t_b nicht adressierbar (publish/update/delete → 404)", async () => {
    const { app, authDb } = makeApp();
    const cookieA = await sessionAs(app, authDb, HOST_A, "content");
    const created = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, cookieA);
    const { id } = (await created.json()) as { id: string };

    const cookieB = await sessionAs(app, authDb, HOST_B, "content");
    expect((await postJson(app, `/api/v1/admin/articles/${id}/publish`, HOST_B, {}, cookieB)).status).toBe(404);
    expect(
      (
        await app.request(`/api/v1/admin/articles/${id}`, {
          method: "PUT",
          headers: { host: HOST_B, cookie: cookieB, "content-type": "application/json" },
          body: JSON.stringify({ title: "hijack" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/v1/admin/articles/${id}`, {
          method: "DELETE",
          headers: { host: HOST_B, cookie: cookieB },
        })
      ).status,
    ).toBe(404);
  });
});

describe("Such-Index-Sync (Infra-Plan Schritt 6)", () => {
  it("publish/unpublish/delete stoßen den Index-Sync mit Tenant+Artikel an; create (draft) nicht", async () => {
    const { app, authDb, indexCalls } = makeApp();
    const cookie = await sessionAs(app, authDb, HOST_A, "content");

    const created = await postJson(app, "/api/v1/admin/articles", HOST_A, VALID_ARTICLE, cookie);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(indexCalls).toHaveLength(0); // Draft ist nie im Index

    await postJson(app, `/api/v1/admin/articles/${id}/publish`, HOST_A, {}, cookie);
    await postJson(app, `/api/v1/admin/articles/${id}/unpublish`, HOST_A, {}, cookie);
    const del = await app.request(`/api/v1/admin/articles/${id}`, {
      method: "DELETE",
      headers: { host: HOST_A, cookie },
    });
    expect(del.status).toBe(200);

    expect(indexCalls).toEqual([
      { tenantId: "t_a", articleId: id },
      { tenantId: "t_a", articleId: id },
      { tenantId: "t_a", articleId: id },
    ]);
  });

  it("POST /admin/articles/reindex ist OWNER-exklusiv (content → 403)", async () => {
    const { app, authDb } = makeApp();
    const contentCookie = await sessionAs(app, authDb, HOST_A, "content");
    expect(
      (await postJson(app, "/api/v1/admin/articles/reindex", HOST_A, {}, contentCookie)).status,
    ).toBe(403);

    const ownerCookie = await sessionAs(app, authDb, HOST_A, "owner");
    const res = await postJson(app, "/api/v1/admin/articles/reindex", HOST_A, {}, ownerCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, articles: 0, chunks: 0, embedded: 0 });
  });
});

/* ————— Import/Export (Content-Werkzeuge; Anti-Lock-in) ————— */

function getPath(app: TestApp, path: string, host: string, cookie?: string) {
  return app.request(path, {
    method: "GET",
    headers: { host, ...(cookie ? { cookie } : {}) },
  });
}

/** Zwei verknüpfte Artikel anlegen (einer published) — Basis für Export-Tests. */
async function seedTwoArticles(f: ReturnType<typeof makeApp>, cookie: string) {
  const first = await postJson(f.app, "/api/v1/admin/articles", HOST_A, {
    slug: "erster-artikel",
    title: "Erster Artikel",
    category: "Start",
    body: ["Absatz A1.", "Absatz A2."],
  }, cookie);
  const firstId = ((await first.json()) as { id: string }).id;

  const second = await postJson(f.app, "/api/v1/admin/articles", HOST_A, {
    slug: "zweiter-artikel",
    title: "Zweiter Artikel",
    category: "Start",
    body: ["Absatz B1."],
    relatedIds: [firstId],
  }, cookie);
  const secondId = ((await second.json()) as { id: string }).id;

  expect(
    (await postJson(f.app, `/api/v1/admin/articles/${firstId}/publish`, HOST_A, {}, cookie))
      .status,
  ).toBe(200);
  return { firstId, secondId };
}

describe("GET /api/v1/admin/articles/export + /:id/markdown", () => {
  it("liefert den Vollbestand mit Slug-Verweisen; anonym → 401", async () => {
    const f = makeApp();
    const cookie = await sessionAs(f.app, f.authDb, HOST_A, "content");
    await seedTwoArticles(f, cookie);

    expect((await getPath(f.app, "/api/v1/admin/articles/export", HOST_A)).status).toBe(401);

    const res = await getPath(f.app, "/api/v1/admin/articles/export", HOST_A, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("hallofhelp-tenant-a-artikel.json");
    const file = (await res.json()) as {
      format: string;
      articles: { slug: string; status: string; relatedSlugs: string[] }[];
    };
    expect(file.format).toBe("hallofhelp/articles@1");
    expect(file.articles).toHaveLength(2);
    const second = file.articles.find((a) => a.slug === "zweiter-artikel")!;
    // Querverweis reist als SLUG (portabel), nicht als Instanz-Id.
    expect(second.relatedSlugs).toEqual(["erster-artikel"]);
    expect(file.articles.find((a) => a.slug === "erster-artikel")!.status).toBe("published");
  });

  it("Markdown-Export: Front-Matter + H1 + Absätze", async () => {
    const f = makeApp();
    const cookie = await sessionAs(f.app, f.authDb, HOST_A, "content");
    const { firstId } = await seedTwoArticles(f, cookie);

    const res = await getPath(f.app, `/api/v1/admin/articles/${firstId}/markdown`, HOST_A, cookie);
    expect(res.status).toBe(200);
    const md = await res.text();
    expect(md).toContain("slug: erster-artikel");
    expect(md).toContain("# Erster Artikel");
    expect(md).toContain("Absatz A1.\n\nAbsatz A2.");
  });
});

describe("POST /api/v1/admin/articles/import", () => {
  it("Roundtrip in ANDERE Instanz: Export A → Import B (Drafts, Verweise aufgelöst, A unberührt)", async () => {
    const f = makeApp();
    const cookieA = await sessionAs(f.app, f.authDb, HOST_A, "content");
    await seedTwoArticles(f, cookieA);
    const file = await (
      await getPath(f.app, "/api/v1/admin/articles/export", HOST_A, cookieA)
    ).json();

    const cookieB = await sessionAs(f.app, f.authDb, HOST_B, "content");
    const res = await postJson(f.app, "/api/v1/admin/articles/import", HOST_B, file, cookieB);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 2, updated: 0, failed: 0 });

    // In B: beide als DRAFT (auch der in A veröffentlichte), Verweis zeigt auf B-Id.
    const bArticles = await f.store.listForTransfer("t_b");
    expect(bArticles).toHaveLength(2);
    expect(bArticles.every((a) => a.lifecycle === "draft")).toBe(true);
    const bSecond = bArticles.find((a) => a.slug === "zweiter-artikel")!;
    const bFirst = bArticles.find((a) => a.slug === "erster-artikel")!;
    expect(bSecond.relatedIds).toEqual([bFirst.id]);

    // A ist unberührt (weiterhin 2 Artikel, erster published).
    const aArticles = await f.store.listForTransfer("t_a");
    expect(aArticles).toHaveLength(2);
    expect(aArticles.find((a) => a.slug === "erster-artikel")!.lifecycle).toBe("published");
  });

  it("Upsert per Slug: Re-Import aktualisiert Inhalte, erhält Status, stößt Index nur für Veröffentlichtes an", async () => {
    const f = makeApp();
    const cookie = await sessionAs(f.app, f.authDb, HOST_A, "content");
    const { firstId } = await seedTwoArticles(f, cookie);
    const file = (await (
      await getPath(f.app, "/api/v1/admin/articles/export", HOST_A, cookie)
    ).json()) as { articles: { slug: string; body: string[] }[] };

    file.articles.find((a) => a.slug === "erster-artikel")!.body = ["Absatz A1 GEÄNDERT."];
    f.indexCalls.length = 0;

    const res = await postJson(f.app, "/api/v1/admin/articles/import", HOST_A, file, cookie);
    expect(await res.json()).toMatchObject({ created: 0, updated: 2, failed: 0 });

    const after = await f.store.listForTransfer("t_a");
    const first = after.find((a) => a.slug === "erster-artikel")!;
    expect(first.lifecycle).toBe("published");
    expect(first.body).toEqual(["Absatz A1 GEÄNDERT."]);
    // Index-Sync NUR für den veröffentlichten Artikel (Draft bleibt draußen).
    expect(f.indexCalls.map((cl) => cl.articleId)).toContain(firstId);
    expect(f.indexCalls).toHaveLength(1);
  });

  it("Markdown-Import: Front-Matter + H1 → Draft; ohne H1 → 400; Teilfehler brechen Bulk nicht ab", async () => {
    const f = makeApp();
    const cookie = await sessionAs(f.app, f.authDb, HOST_A, "content");

    const md = [
      "---",
      "slug: aus-markdown",
      "category: Import-Test",
      "---",
      "",
      "# Aus Markdown",
      "",
      "Erster Absatz aus Markdown.",
      "",
      "## Zwischentitel",
      "",
      "- Punkt eins",
      "- Punkt zwei",
    ].join("\n");
    const res = await postJson(f.app, "/api/v1/admin/articles/import", HOST_A, { markdown: md }, cookie);
    expect(await res.json()).toMatchObject({ created: 1, failed: 0 });
    const created = (await f.store.listForTransfer("t_a")).find((a) => a.slug === "aus-markdown")!;
    expect(created.lifecycle).toBe("draft");
    expect(created.title).toBe("Aus Markdown");
    expect(created.category).toBe("Import-Test");
    // Struktur bleibt VERBATIM erhalten (Rich-Text-Subset), nicht mehr gestrippt.
    expect(created.body).toEqual([
      "Erster Absatz aus Markdown.",
      "## Zwischentitel",
      "- Punkt eins\n- Punkt zwei",
    ]);

    expect(
      (
        await postJson(f.app, "/api/v1/admin/articles/import", HOST_A, { markdown: "nur text ohne titel" }, cookie)
      ).status,
    ).toBe(400);

    const bulk = {
      format: "hallofhelp/articles@1",
      articles: [
        { slug: "ok-artikel", title: "Ok", category: "Import", body: ["Text."] },
        { slug: "kaputt", category: "Import", body: ["Ohne Titel."] },
      ],
    };
    const mixed = await postJson(f.app, "/api/v1/admin/articles/import", HOST_A, bulk, cookie);
    expect(await mixed.json()).toMatchObject({ created: 1, failed: 1 });
  });
});

/* ————— Bilder (R2-Upload, Pflicht-Beschreibung, public Serving) ————— */

/** Minimale, magic-bytes-gültige PNG-Datei (Header reicht dem Sniffer). */
function pngFile(size = 64, name = "bild.png"): File {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([bytes as unknown as BlobPart], name, { type: "image/png" });
}

function uploadImage(
  f: ReturnType<typeof makeApp>,
  articleId: string,
  cookie: string,
  opts: { file?: File | null; description?: string } = {},
) {
  const form = new FormData();
  if (opts.file !== null) form.append("file", opts.file ?? pngFile());
  if (opts.description !== undefined) form.append("description", opts.description);
  return f.app.request(`/api/v1/admin/articles/${articleId}/images`, {
    method: "POST",
    headers: { host: HOST_A, cookie },
    body: form,
  });
}

describe("Artikel-Bilder: Upload + Validierung + Serving", () => {
  it("Upload mit Pflicht-Beschreibung → 201, Metadaten + R2-Objekt + Index-Sync", async () => {
    const f = makeApp();
    const cookie = await sessionAs(f.app, f.authDb, HOST_A, "content");
    const { firstId } = await seedTwoArticles(f, cookie);
    f.indexCalls.length = 0;

    const res = await uploadImage(f, firstId, cookie, { description: "Screenshot der Team-Seite" });
    expect(res.status).toBe(201);
    const { image } = (await res.json()) as { image: { id: string; description: string } };
    expect(image.description).toBe("Screenshot der Team-Seite");

    const article = await f.store.getForEdit("t_a", firstId, "de");
    expect(article?.images).toEqual([image]);
    expect(f.mediaObjects.has(`tenants/t_a/articles/${firstId}/${image.id}`)).toBe(true);
    // Beschreibung ist KI-Kontext → Index-Sync wurde angestoßen.
    expect(f.indexCalls.map((cl) => cl.articleId)).toContain(firstId);
  });

  it("ohne Beschreibung → 400; Müll-Bytes → 415; zu groß → 413; unbekannter Artikel → 404 (+R2 leer)", async () => {
    const f = makeApp();
    const cookie = await sessionAs(f.app, f.authDb, HOST_A, "content");
    const { firstId } = await seedTwoArticles(f, cookie);

    expect((await uploadImage(f, firstId, cookie, { description: "   " })).status).toBe(400);
    expect((await uploadImage(f, firstId, cookie, {})).status).toBe(400);

    const garbage = new File([new Uint8Array([1, 2, 3, 4, 5]) as unknown as BlobPart], "x.png");
    expect(
      (await uploadImage(f, firstId, cookie, { file: garbage, description: "ok lang genug" }))
        .status,
    ).toBe(415);

    expect(
      (
        await uploadImage(f, firstId, cookie, {
          file: pngFile(2 * 1024 * 1024 + 1),
          description: "riesig",
        })
      ).status,
    ).toBe(413);

    expect(
      (await uploadImage(f, "art_gibtsnicht", cookie, { description: "beschreibung" })).status,
    ).toBe(404);
    // Fehlversuche hinterlassen KEINE verwaisten R2-Objekte.
    expect(f.mediaObjects.size).toBe(0);
  });

  it("public Serving: Draft → 404, published → 200 (content-type, immutable); fremder Tenant → 404; Delete räumt auf", async () => {
    const f = makeApp();
    const cookie = await sessionAs(f.app, f.authDb, HOST_A, "content");
    const { firstId, secondId } = await seedTwoArticles(f, cookie);

    // secondId ist DRAFT: Upload ok, public Serving muss 404 bleiben.
    const draftUp = await uploadImage(f, secondId, cookie, { description: "Draft-Bild" });
    const draftImage = ((await draftUp.json()) as { image: { id: string } }).image;
    const draftServe = await f.app.request(
      `/api/v1/content/images/zweiter-artikel/${draftImage.id}`,
      { headers: { host: HOST_A } },
    );
    expect(draftServe.status).toBe(404);

    // firstId ist PUBLISHED: Serving liefert Bytes mit Typ + immutable-Cache.
    const pubUp = await uploadImage(f, firstId, cookie, { description: "Veröffentlichtes Bild" });
    const pubImage = ((await pubUp.json()) as { image: { id: string } }).image;
    const serve = await f.app.request(`/api/v1/content/images/erster-artikel/${pubImage.id}`, {
      headers: { host: HOST_A },
    });
    expect(serve.status).toBe(200);
    expect(serve.headers.get("content-type")).toBe("image/png");
    expect(serve.headers.get("cache-control")).toContain("immutable");

    // Fremder Tenant (Host B) erreicht das Bild NIE (Host-Scoping).
    const cross = await f.app.request(`/api/v1/content/images/erster-artikel/${pubImage.id}`, {
      headers: { host: HOST_B },
    });
    expect(cross.status).toBe(404);

    // Delete: Metadaten + R2-Objekt weg, Serving 404.
    const del = await f.app.request(
      `/api/v1/admin/articles/${firstId}/images/${pubImage.id}`,
      { method: "DELETE", headers: { host: HOST_A, cookie } },
    );
    expect(del.status).toBe(200);
    expect(f.mediaObjects.has(`tenants/t_a/articles/${firstId}/${pubImage.id}`)).toBe(false);
    expect(
      (
        await f.app.request(`/api/v1/content/images/erster-artikel/${pubImage.id}`, {
          headers: { host: HOST_A },
        })
      ).status,
    ).toBe(404);
  });

  it("Limit: ab Bild Nr. 13 → 409 too_many_images", async () => {
    const f = makeApp();
    const cookie = await sessionAs(f.app, f.authDb, HOST_A, "content");
    const { firstId } = await seedTwoArticles(f, cookie);
    const filled = Array.from({ length: 12 }, (_, i) => ({ id: `img${i}`, description: `d${i}` }));
    f.contentDb
      .prepare(`UPDATE articles SET images_json = ? WHERE id = ? AND tenant_id = 't_a'`)
      .run(JSON.stringify(filled), firstId);

    const res = await uploadImage(f, firstId, cookie, { description: "eins zu viel" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "too_many_images" });
  });
});

/* ————— Übersetzungen (Translation-Sets + KI-Übersetzung als Credit-Feature) ————— */

const FAKE_TRANSLATOR = async (input: TranslateArticleInput): Promise<TranslateArticleResult> => ({
  title: `EN: ${input.title}`,
  body: input.body.map((b) => (b.startsWith("```") ? b : `EN: ${b}`)),
  imageDescriptions: input.imageDescriptions.map((d) => `EN: ${d}`),
});

describe("POST /api/v1/admin/articles/:id/translations", () => {
  it("manual: Draft-Kopie im Set (Slug -en, gleicher article_key); Duplikat → 409", async () => {
    const f = makeApp();
    const cookie = await sessionAs(f.app, f.authDb, HOST_A, "content");
    const { firstId } = await seedTwoArticles(f, cookie);

    const res = await postJson(
      f.app,
      `/api/v1/admin/articles/${firstId}/translations`,
      HOST_A,
      { locale: "en", mode: "manual" },
      cookie,
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; slug: string; locale: string };
    expect(created.slug).toBe("erster-artikel-en");
    expect(created.locale).toBe("en");

    const rows = await f.store.listTranslations("t_a", firstId);
    expect(rows.map((r) => `${r.locale}:${r.lifecycle}`)).toEqual(["de:published", "en:draft"]);

    // Set-Mitgliedschaft: neue Zeile teilt den article_key des Originals.
    const all = await f.store.listForTransfer("t_a");
    const en = all.find((a) => a.slug === "erster-artikel-en")!;
    expect(en.articleKey).toBe(firstId);
    expect(en.body).toEqual(["Absatz A1.", "Absatz A2."]); // Kopie als Startpunkt

    const dup = await postJson(
      f.app,
      `/api/v1/admin/articles/${firstId}/translations`,
      HOST_A,
      { locale: "en", mode: "manual" },
      cookie,
    );
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "translation_exists" });
    // KEINE Credits für manuelle Anlagen.
    expect(f.translationCharges).toHaveLength(0);
  });

  it("ai: übersetzt Titel/Blöcke, markiert als KI, verbucht NACH Erfolg genau einmal", async () => {
    const f = makeApp(true, { translator: FAKE_TRANSLATOR });
    const cookie = await sessionAs(f.app, f.authDb, HOST_A, "content");
    const { firstId } = await seedTwoArticles(f, cookie);

    const res = await postJson(
      f.app,
      `/api/v1/admin/articles/${firstId}/translations`,
      HOST_A,
      { locale: "en", mode: "ai" },
      cookie,
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const en = (await f.store.listForTransfer("t_a")).find((a) => a.id === id)!;
    expect(en.title).toBe("EN: Erster Artikel");
    expect(en.body).toEqual(["EN: Absatz A1.", "EN: Absatz A2."]);
    expect(en.lifecycle).toBe("draft");
    expect(f.translationCharges).toEqual([{ tenantId: "t_a", articleId: id }]);
  });

  it("ai-Fehlschlag: 502, KEINE Zeile, KEINE Credits; ohne Übersetzer → 503", async () => {
    const failing = makeApp(true, {
      translator: async () => {
        throw new Error("model down");
      },
    });
    const cookie = await sessionAs(failing.app, failing.authDb, HOST_A, "content");
    const { firstId } = await seedTwoArticles(failing, cookie);

    const res = await postJson(
      failing.app,
      `/api/v1/admin/articles/${firstId}/translations`,
      HOST_A,
      { locale: "en", mode: "ai" },
      cookie,
    );
    expect(res.status).toBe(502);
    expect((await failing.store.listForTransfer("t_a")).map((a) => a.locale)).toEqual(["de", "de"]);
    expect(failing.translationCharges).toHaveLength(0);

    const without = makeApp();
    const cookie2 = await sessionAs(without.app, without.authDb, HOST_A, "content");
    const seeded = await seedTwoArticles(without, cookie2);
    const res2 = await postJson(
      without.app,
      `/api/v1/admin/articles/${seeded.firstId}/translations`,
      HOST_A,
      { locale: "en", mode: "ai" },
      cookie2,
    );
    expect(res2.status).toBe(503);
  });

  it("Locale-Filter: EN-Fassung erscheint NICHT in der Default-Liste, ist aber per Slug erreichbar (published) + siblings", async () => {
    const f = makeApp();
    const cookie = await sessionAs(f.app, f.authDb, HOST_A, "content");
    const { firstId } = await seedTwoArticles(f, cookie);

    const created = (await (
      await postJson(
        f.app,
        `/api/v1/admin/articles/${firstId}/translations`,
        HOST_A,
        { locale: "en", mode: "manual" },
        cookie,
      )
    ).json()) as { id: string };
    await postJson(f.app, `/api/v1/admin/articles/${created.id}/publish`, HOST_A, {}, cookie);

    // Öffentliche Liste (Anzeige-Locale de) enthält die EN-Fassung NICHT …
    const list = await f.store.listPublishedArticles("t_a", "de");
    expect(list.map((a) => a.slug)).not.toContain("erster-artikel-en");
    // … aber der direkte Slug-Zugriff liefert sie (Sprachumschalter-Ziel).
    const bySlug = await f.store.getPublishedArticleBySlugOrId("t_a", "de", "erster-artikel-en");
    expect(bySlug?.locale).toBe("en");
    // Geschwister fürs Umschalter-UI: beide veröffentlichten Fassungen.
    const siblings = await f.store.getPublishedSiblings("t_a", firstId);
    expect(siblings).toEqual([
      { locale: "de", slug: "erster-artikel" },
      { locale: "en", slug: "erster-artikel-en" },
    ]);
  });
});

describe("Videos im Entwurfs-Zyklus (YouTube v1)", () => {
  it("PUT mit videos: URL→ID normalisiert + persistiert; ungültige Quelle → 400", async () => {
    const f = makeApp();
    const cookie = await sessionAs(f.app, f.authDb, HOST_A, "content");
    const { firstId } = await seedTwoArticles(f, cookie);

    const put = await f.app.request(`/api/v1/admin/articles/${firstId}`, {
      method: "PUT",
      headers: { host: HOST_A, "content-type": "application/json", cookie },
      body: JSON.stringify({
        videos: [
          {
            id: "v1",
            title: "Produkt-Rundgang",
            description: "Zeigt die ersten Schritte im Hilfezentrum",
            youtubeUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
            durationLabel: "0:19",
          },
        ],
      }),
    });
    expect(put.status).toBe(200);

    const article = await f.store.getForEdit("t_a", firstId, "de");
    expect(article?.videos).toEqual([
      {
        id: "v1",
        title: "Produkt-Rundgang",
        durationLabel: "0:19",
        description: "Zeigt die ersten Schritte im Hilfezentrum",
        youtubeId: "jNQXAC9IVRw",
      },
    ]);

    const bad = await f.app.request(`/api/v1/admin/articles/${firstId}`, {
      method: "PUT",
      headers: { host: HOST_A, "content-type": "application/json", cookie },
      body: JSON.stringify({
        videos: [{ id: "v2", title: "x", description: "d", youtubeUrl: "https://vimeo.com/1" }],
      }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "youtube_url_invalid" });
  });
});
