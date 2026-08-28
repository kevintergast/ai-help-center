import Database from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { D1ContentRepository } from "@/server/content/store";
import { D1ApiKeyRepository } from "@/server/apikeys/store";
import { generateApiKey, hashApiKey } from "@/server/apikeys/keys";
import type { ApiScope } from "@/server/apikeys/scopes";
import { makeConfirmationCodec, type ConfirmationStore } from "@/server/mcp/confirm";
import { LATEST_PROTOCOL_VERSION } from "@/server/mcp/protocol";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";

/**
 * MCP-SERVER end-to-end über `app.request()` — Protokollkonformität, Scope-
 * Durchsetzung und das Zwei-Schritt-Löschen.
 *
 * Content läuft über den ECHTEN D1ContentRepository (sqlite-Shim gegen die
 * echte Migrations-DDL); Schlüssel werden direkt ins Repo geschrieben (die
 * Erstellungs-Route ist in app.apikeys.test.ts abgedeckt).
 */

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";
const HOST_A = "tenant-a.hallofhelp.com";
const HOST_B = "tenant-b.hallofhelp.com";
const MCP = "/api/v1/mcp";

const MIGRATIONS = [
  "0001_tenants.sql", "0021_tenant_suspend.sql", "0023_logo_dark.sql", "0025_header_name.sql",
  "0002_auth.sql", "0004_two_factor_plugin_columns.sql",
  "0005_content.sql", "0030_changelog_version.sql", "0018_article_images.sql", "0029_article_files.sql", "0019_article_translations.sql", "0024_article_flag.sql",
  "0027_api_keys.sql",
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

function makeApp() {
  const db = new Database(":memory:");
  applyMigrations(db, MIGRATIONS);
  db.prepare("INSERT INTO tenants (id, slug, name) VALUES ('t_a','tenant-a','A')").run();
  db.prepare("INSERT INTO tenants (id, slug, name) VALUES ('t_b','tenant-b','B')").run();

  const d1 = d1FromSqlite(db);
  const store = new D1ContentRepository(d1);
  const keys = new D1ApiKeyRepository(d1);

  // KV-Fake für den Einmalverbrauch der Bestätigungs-Token.
  const kv = new Map<string, string>();
  const confirmStore: ConfirmationStore = {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => void kv.set(k, v),
  };

  const indexCalls: string[] = [];
  const auditEntries: { action: string; targetId?: string | null }[] = [];
  // Zähler statt echter KI: belegt, dass ohne Transkript NICHT zusammengefasst
  // (und damit nichts berechnet) wird.
  const summarizer = { calls: 0 };

  // R2-Fake: hält die Bild-Bytes, damit Tests belegen können, dass ein Bild
  // WIRKLICH gespeichert wurde — und dass nach einem Fehlschlag KEIN
  // verwaistes Objekt zurückbleibt.
  const mediaObjects = new Map<string, Uint8Array>();
  const media = {
    put: async (key: string, value: ArrayBuffer | Uint8Array) => {
      mediaObjects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
    },
    get: async () => null,
    delete: async (key: string) => void mediaObjects.delete(key),
  };

  const deps: ApiDeps = {
    resolveTenant: async (host) => TENANTS[(host ?? "").split(":")[0].toLowerCase()] ?? null,
    createAuthForTenant: async () =>
      buildAuth({ adapter: memoryAdapter({})(tenantAuthOptions(TEST_SECRET)), secret: TEST_SECRET }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => ({
      invitations: {} as never,
      users: {} as never,
      audit: {
        append: async (e) => {
          auditEntries.push({ action: e.action, targetId: e.targetId });
        },
      },
      sendInvitationEmail: async () => false,
    }),
    getLegalDeps: async () => null,
    getContentDeps: async () => ({ store, media }),
    getApiKeyDeps: async () => ({ repo: keys }),
    getConfirmations: async (tenantId) =>
      makeConfirmationCodec({
        secret: `${TEST_SECRET}:${tenantId}`,
        now: () => Math.floor(Date.now() / 1000),
        store: confirmStore,
      }),
    getVideoSummarizer: async () => async (input: { transcript: string }) => {
      summarizer.calls += 1;
      return { title: "KI-Titel", description: `Zusammenfassung: ${input.transcript.slice(0, 40)}` };
    },
    getContentIndexer: async () => ({
      onContentChange: async (_t, articleId) => void indexCalls.push(articleId),
      rebuildTenant: async () => ({ articles: 0, chunks: 0, embedded: 0 }),
    }),
  };

  return {
    app: buildApiApp(deps), db, store, keys, indexCalls, auditEntries, mediaObjects,
    get summarizerCalls() { return summarizer.calls; },
  };
}

type TestApp = ReturnType<typeof makeApp>["app"];

/** Schlüssel direkt anlegen (die Erstellungs-Route testet app.apikeys.test.ts). */
async function issueKey(
  keys: D1ApiKeyRepository,
  tenantId: string,
  scopes: ApiScope[],
): Promise<string> {
  const { token, prefix } = generateApiKey();
  const nowSec = Math.floor(Date.now() / 1000);
  await keys.create({
    id: crypto.randomUUID(),
    tenantId,
    name: "Test-Agent",
    keyHash: await hashApiKey(token),
    keyPrefix: prefix,
    scopes,
    createdBy: null,
    createdAt: nowSec,
    expiresAt: nowSec + 3600,
  });
  return token;
}

interface RpcOptions {
  host?: string;
  headers?: Record<string, string>;
  /** Standard: moderne Ära inkl. Pflicht-Header. */
  modern?: boolean;
}

async function rpc(
  app: TestApp,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  opts: RpcOptions = {},
) {
  const modern = opts.modern !== false;
  const name =
    method === "tools/call" && typeof params.name === "string" ? (params.name as string) : undefined;

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: modern
      ? {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": LATEST_PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        }
      : params,
  };

  const res = await app.request(MCP, {
    method: "POST",
    headers: {
      host: opts.host ?? HOST_A,
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(modern
        ? {
            "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
            "mcp-method": method,
            ...(name ? { "mcp-name": name } : {}),
          }
        : {}),
      ...opts.headers,
    },
    body: JSON.stringify(body),
  });
  return { res, json: (await res.json()) as Record<string, never> };
}

/** Werkzeug aufrufen und das (JSON-geparste) Tool-Ergebnis zurückgeben. */
async function callTool(
  app: TestApp,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
  opts: RpcOptions = {},
) {
  const { res, json } = await rpc(app, token, "tools/call", { name, arguments: args }, opts);
  const result = (json as Record<string, Record<string, unknown>>).result;
  const structured = result?.structuredContent as Record<string, unknown> | undefined;
  return { status: res.status, isError: result?.isError === true, data: structured, raw: json };
}

async function seedArticle(app: TestApp, token: string, slug: string, title = "Titel") {
  const created = await callTool(app, token, "create_article", {
    slug,
    title,
    category: "Erste Schritte",
    body: [{ type: "text", variant: "standard", text: "Ein hinreichend langer Textblock." }],
  });
  expect(created.isError).toBe(false);
  return created.data!.id as string;
}

describe("MCP — Protokoll", () => {
  it("beantwortet tools/list und nennt sich selbst", async () => {
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:read"]);

    const { res, json } = await rpc(app, token, "tools/list");
    expect(res.status).toBe(200);
    const result = (json as Record<string, Record<string, unknown>>).result;
    expect(result.resultType).toBe("complete");
    expect(Array.isArray(result.tools)).toBe(true);
  });

  it("weist eine unbekannte Methode mit 404 + -32601 ab", async () => {
    // Die Spec verlangt genau diese Kombination — daran unterscheidet ein
    // Client uns von einem Server, der den Pfad gar nicht kennt.
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:read"]);

    const { res, json } = await rpc(app, token, "resources/list");
    expect(res.status).toBe(404);
    expect((json as Record<string, Record<string, number>>).error.code).toBe(-32601);
  });

  it("weist eine unbekannte Protokollversion ab und nennt die unterstützten", async () => {
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:read"]);

    const res = await app.request(MCP, {
      method: "POST",
      headers: {
        host: HOST_A,
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "mcp-protocol-version": "1999-01-01",
        "mcp-method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { _meta: { "io.modelcontextprotocol/protocolVersion": "1999-01-01" } },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number; data: { supported: string[] } } };
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.supported).toContain(LATEST_PROTOCOL_VERSION);
  });

  it("weist Header ab, die dem Body widersprechen (-32020)", async () => {
    // Sicherheitsrelevant: eine Zwischenstation routet/limitiert nach den
    // HEADERN, während wir den BODY ausführen. Weichen beide ab, entscheidet
    // sie über etwas anderes, als tatsächlich passiert.
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:read"]);

    const { res, json } = await rpc(
      app,
      token,
      "tools/call",
      { name: "list_articles", arguments: {} },
      { headers: { "mcp-name": "delete_article" } },
    );
    expect(res.status).toBe(400);
    expect((json as Record<string, Record<string, number>>).error.code).toBe(-32020);
  });

  it("bedient auch Clients der initialize-Ära — ohne Session-Id", async () => {
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:read"]);

    const { res, json } = await rpc(
      app,
      token,
      "initialize",
      { protocolVersion: "2025-06-18" },
      { modern: false, headers: { "mcp-protocol-version": "2025-06-18" } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const result = (json as Record<string, Record<string, unknown>>).result;
    expect(result.protocolVersion).toBe("2025-06-18");
  });

  it("antwortet auf GET/DELETE mit 405 und auf einen fremden Origin mit 403", async () => {
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:read"]);

    for (const method of ["GET", "DELETE"]) {
      const res = await app.request(MCP, {
        method,
        headers: { host: HOST_A, authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(405);
    }

    const { res } = await rpc(app, token, "tools/list", {}, { headers: { origin: "http://evil.test" } });
    expect(res.status).toBe(403);
  });
});

describe("MCP — Scopes", () => {
  it("zeigt nur erlaubte Werkzeuge …", async () => {
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:read", "articles:write"]);

    const { json } = await rpc(app, token, "tools/list");
    const names = (
      (json as Record<string, { tools: { name: string }[] }>).result.tools
    ).map((t) => t.name);

    expect(names).toContain("create_article");
    expect(names).not.toContain("publish_article");
    expect(names).not.toContain("delete_article");
    expect(names).not.toContain("get_stats");
  });

  it("… und sperrt sie AUCH beim direkten Aufruf (Verstecken ist kein Schutz)", async () => {
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:read", "articles:write"]);
    const id = await seedArticle(app, token, "test-artikel");

    const { res, json } = await rpc(app, token, "tools/call", {
      name: "publish_article",
      arguments: { id },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toContain("insufficient_scope");
    expect((json as Record<string, Record<string, unknown>>).error.data).toMatchObject({
      requiredScope: "articles:publish",
    });
  });

  it("erklärt dem Modell seine Rechte (get_permissions)", async () => {
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:read"]);

    const { data } = await callTool(app, token, "get_permissions");
    expect((data!.grants as { scope: string }[]).map((g) => g.scope)).toEqual(["articles:read"]);
    expect((data!.notGranted as { scope: string }[]).some((g) => g.scope === "articles:delete")).toBe(true);
  });
});

describe("MCP — Artikel schreiben", () => {
  it("legt Artikel IMMER als Entwurf an", async () => {
    // Kern der Zusage „KI schreibt, Mensch gibt frei": ohne diesen Test könnte
    // ein späterer Umbau still auf 'published' umstellen.
    const { app, keys, store } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:read", "articles:write"]);

    const id = await seedArticle(app, token, "neuer-artikel", "Neuer Artikel");
    const rows = await store.listAdminRows("t_a", "de");
    expect(rows.find((r) => r.id === id)?.status).toBe("draft");

    const published = await store.listPublishedArticles("t_a", "de");
    expect(published).toHaveLength(0);
  });

  it("meldet einen Slug-Konflikt als korrigierbaren Fachfehler", async () => {
    // isError-Result statt JSON-RPC-Fehler: das Modell soll den Slug ändern
    // können, statt die Verbindung für kaputt zu halten.
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:read", "articles:write"]);
    await seedArticle(app, token, "doppelt");

    const again = await callTool(app, token, "create_article", {
      slug: "doppelt",
      title: "Nochmal",
      category: "Erste Schritte",
      body: ["Text"],
    });
    expect(again.status).toBe(200);
    expect(again.isError).toBe(true);
    expect(again.data!.error).toBe("slug_conflict");
  });

  it("lehnt ungültige Blöcke ab, ohne den Server zu sprengen", async () => {
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:write"]);

    const bad = await callTool(app, token, "create_article", {
      slug: "kaputt",
      title: "Kaputt",
      category: "X",
      body: [{ type: "quatsch" }],
    });
    expect(bad.status).toBe(200);
    expect(bad.isError).toBe(true);
  });

  it("sieht keine Artikel eines anderen Mandanten", async () => {
    const { app, keys } = makeApp();
    const tokenA = await issueKey(keys, "t_a", ["articles:read", "articles:write"]);
    const tokenB = await issueKey(keys, "t_b", ["articles:read", "articles:write"]);
    const idA = await seedArticle(app, tokenA, "nur-fuer-a");

    const fromB = await callTool(app, tokenB, "get_article", { id: idA }, { host: HOST_B });
    expect(fromB.isError).toBe(true);
    expect(fromB.data!.error).toBe("not_found");
  });

  it("veröffentlicht mit dem passenden Scope", async () => {
    const { app, keys, store, indexCalls } = makeApp();
    const token = await issueKey(keys, "t_a", ["articles:read", "articles:write", "articles:publish"]);
    const id = await seedArticle(app, token, "geht-live");

    const published = await callTool(app, token, "publish_article", { id });
    expect(published.isError).toBe(false);
    expect((await store.listPublishedArticles("t_a", "de")).map((a) => a.id)).toContain(id);
    expect(indexCalls).toContain(id);
  });
});

describe("MCP — Löschen nur mit Bestätigung", () => {
  const DELETE_SCOPES: ApiScope[] = ["articles:read", "articles:write", "articles:delete"];

  it("löscht beim ersten Aufruf NICHTS, sondern beschreibt die Folgen", async () => {
    const { app, keys, store } = makeApp();
    const token = await issueKey(keys, "t_a", DELETE_SCOPES);
    const id = await seedArticle(app, token, "bitte-nicht", "Bitte nicht löschen");

    const first = await callTool(app, token, "delete_article", { id });
    expect(first.isError).toBe(false);
    expect(first.data!.status).toBe("confirmation_required");
    expect(first.data!.confirmation_token).toBeTruthy();
    expect((first.data!.wouldDelete as { title: string }).title).toBe("Bitte nicht löschen");

    // Der Artikel ist noch da — das ist der ganze Punkt.
    expect(await store.getForEdit("t_a", id, "de")).not.toBeNull();
  });

  it("löscht erst mit gültigem Token", async () => {
    const { app, keys, store, auditEntries } = makeApp();
    const token = await issueKey(keys, "t_a", DELETE_SCOPES);
    const id = await seedArticle(app, token, "weg-damit");

    const first = await callTool(app, token, "delete_article", { id });
    const confirmed = await callTool(app, token, "delete_article", {
      id,
      confirmation_token: first.data!.confirmation_token,
    });

    expect(confirmed.isError).toBe(false);
    expect(confirmed.data!.deleted).toBe(true);
    expect(await store.getForEdit("t_a", id, "de")).toBeNull();
    expect(auditEntries.map((e) => e.action)).toContain("mcp.article.deleted");
  });

  it("akzeptiert ein Token kein zweites Mal", async () => {
    // Sonst wäre ein Retry (oder ein Modell in der Schleife) ein zweiter
    // Löschbefehl ohne zweite Rückfrage beim Menschen.
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", DELETE_SCOPES);
    const first = await seedArticle(app, token, "eins");
    const second = await seedArticle(app, token, "zwei");

    const issued = await callTool(app, token, "delete_article", { id: first });
    const confirmToken = issued.data!.confirmation_token as string;
    await callTool(app, token, "delete_article", { id: first, confirmation_token: confirmToken });

    const replay = await callTool(app, token, "delete_article", {
      id: second,
      confirmation_token: confirmToken,
    });
    expect(replay.isError).toBe(true);
    expect(replay.data!.error).toBe("invalid_confirmation");
  });

  it("akzeptiert kein erfundenes oder fremdes Token", async () => {
    const { app, keys, store } = makeApp();
    const token = await issueKey(keys, "t_a", DELETE_SCOPES);
    const keep = await seedArticle(app, token, "behalten");
    const other = await seedArticle(app, token, "anderer");

    const erfunden = await callTool(app, token, "delete_article", {
      id: keep,
      confirmation_token: "9999999999.ausgedacht",
    });
    expect(erfunden.isError).toBe(true);

    // Token für Artikel B darf Artikel A nicht löschen.
    const forOther = await callTool(app, token, "delete_article", { id: other });
    const wrongTarget = await callTool(app, token, "delete_article", {
      id: keep,
      confirmation_token: forOther.data!.confirmation_token,
    });
    expect(wrongTarget.isError).toBe(true);
    expect(await store.getForEdit("t_a", keep, "de")).not.toBeNull();
  });

  it("verfällt, wenn sich der Artikel zwischenzeitlich geändert hat", async () => {
    const { app, keys } = makeApp();
    const token = await issueKey(keys, "t_a", DELETE_SCOPES);
    const id = await seedArticle(app, token, "bewegt-sich", "Alt");

    const issued = await callTool(app, token, "delete_article", { id });
    await callTool(app, token, "update_article", { id, title: "Inzwischen umbenannt" });

    const stale = await callTool(app, token, "delete_article", {
      id,
      confirmation_token: issued.data!.confirmation_token,
    });
    expect(stale.isError).toBe(true);
    expect(stale.data!.error).toBe("invalid_confirmation");
  });
});

/**
 * MEDIEN PER MCP. Der Anlass dieser Suite ist ein STILLER Datenverlust: Der
 * URL-Import legte Bild- und Video-Blöcke an, lud die Bilder aber nie und
 * erzeugte keine Video-Einträge. Solche Blöcke rendern als `null`
 * (article-blocks-view.tsx) — der Artikel sah nur „kürzer" aus, nichts
 * schlug fehl. Jeder Test hier hält genau einen solchen Fall fest.
 */
describe("MCP — Bilder und Videos", () => {
  // Kleinstes gültiges PNG (Magic Bytes) — sniffImageType akzeptiert es.
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

  const PAGE = `<html><head><title>Glossare | Fremd-Hilfe</title></head><body>
    <article>
      <h1>Glossare</h1>
      <p>Du kannst Glossareinträge für deine Assistenten anlegen.</p>
      <img alt="Screenshot: Glossareintrag anlegen" src="/img/glossar.png">
      <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
    </article></body></html>`;

  /** Zählt, WAS gefetcht wurde — SSRF-Tests belegen darüber „gar nicht". */
  function stubWeb(opts: { imageOk?: boolean } = {}) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/oembed")) return new Response(JSON.stringify({ title: "Glossare erklärt" }));
      if (u.endsWith(".png")) {
        return opts.imageOk === false
          ? new Response("nope", { status: 404 })
          : new Response(PNG.slice() as unknown as BodyInit, { headers: { "content-type": "image/png" } });
      }
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    });
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());

  it("add_image_from_url lädt das Bild, hängt es an den Artikel und liefert die Id", async () => {
    stubWeb();
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const id = await seedArticle(f.app, token, "glossare");

    const added = await callTool(f.app, token, "add_image_from_url", {
      articleId: id,
      url: "https://help.example.com/img/glossar.png",
      description: "Dialog Neuer Glossareintrag mit ausgefülltem Feld Begriff",
    });
    expect(added.isError).toBe(false);
    const imageId = added.data!.imageId as string;

    const article = (await f.store.listForTransfer("t_a")).find((a) => a.id === id)!;
    expect(article.images?.map((i) => i.id)).toContain(imageId);
    expect(article.images?.[0].description).toContain("Glossareintrag");
    // Die Binärdatei liegt wirklich in R2 (nicht nur ein Datensatz):
    expect([...f.mediaObjects.keys()].some((k) => k.includes(imageId))).toBe(true);
  });

  it("add_image_from_url ohne Beschreibung wird abgelehnt — Bilder ohne Alt-Text sind für die KI unsichtbar", async () => {
    const calls = stubWeb();
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const id = await seedArticle(f.app, token, "glossare");

    const added = await callTool(f.app, token, "add_image_from_url", {
      articleId: id,
      url: "https://help.example.com/img/glossar.png",
      description: "   ",
    });
    expect(added.isError).toBe(true);
    expect(added.data!.error).toBe("image_description_required");
    // Und es wurde gar nicht erst geladen:
    expect(calls.some((u) => u.endsWith(".png"))).toBe(false);
    expect(f.mediaObjects.size).toBe(0);
  });

  it("add_image_from_url fasst interne Adressen nicht an (SSRF)", async () => {
    const calls = stubWeb();
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const id = await seedArticle(f.app, token, "glossare");

    const added = await callTool(f.app, token, "add_image_from_url", {
      articleId: id,
      url: "http://169.254.169.254/latest/meta-data/iam.png",
      description: "Egal — darf nie geladen werden.",
    });
    expect(added.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("add_image_from_url an einen unbekannten Artikel lässt kein verwaistes R2-Objekt zurück", async () => {
    stubWeb();
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);

    const added = await callTool(f.app, token, "add_image_from_url", {
      articleId: "gibt-es-nicht",
      url: "https://help.example.com/img/glossar.png",
      description: "Screenshot des Glossars.",
    });
    expect(added.isError).toBe(true);
    expect(added.data!.error).toBe("not_found");
    // Das Objekt war kurz in R2 — es MUSS wieder weg sein (sonst zahlt der
    // Kunde für Bytes, die kein Artikel je referenziert).
    expect(f.mediaObjects.size).toBe(0);
  });

  it("import_article_from_url übernimmt Bilder UND Videos — keine Verweise ins Leere", async () => {
    stubWeb();
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);

    const imported = await callTool(f.app, token, "import_article_from_url", {
      url: "https://help.example.com/help/glossar",
      category: "Wissen anlegen",
    });
    expect(imported.isError).toBe(false);

    const article = (await f.store.listForTransfer("t_a")).find((a) => a.slug === "glossar")!;
    expect(article.lifecycle).toBe("draft"); // niemals direkt öffentlich
    expect(article.category).toBe("Wissen anlegen");

    // JEDER Bild-/Video-Block zeigt auf einen Eintrag, den es wirklich gibt:
    const imageIds = new Set((article.images ?? []).map((i) => i.id));
    const videoIds = new Set(article.videos.map((v) => v.id));
    for (const b of article.body) {
      if (b.type === "image") expect(imageIds.has(b.imageId)).toBe(true);
      if (b.type === "video") expect(videoIds.has(b.videoId)).toBe(true);
    }
    expect(article.body.some((b) => b.type === "image")).toBe(true);
    expect(article.body.some((b) => b.type === "video")).toBe(true);
    expect(article.videos[0]).toMatchObject({ youtubeId: "dQw4w9WgXcQ", title: "Glossare erklärt" });
    expect(article.videos[0].description.length).toBeGreaterThan(0); // Pflichtfeld
    expect([...f.mediaObjects.keys()]).toHaveLength(1);
  });

  it("ein nicht ladbares Bild kippt den Import nicht — sein Block fällt weg", async () => {
    stubWeb({ imageOk: false });
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);

    const imported = await callTool(f.app, token, "import_article_from_url", {
      url: "https://help.example.com/help/glossar",
    });
    expect(imported.isError).toBe(false);

    const article = (await f.store.listForTransfer("t_a")).find((a) => a.slug === "glossar")!;
    expect(article.body.some((b) => b.type === "image")).toBe(false);
    expect(article.body.some((b) => b.type === "video")).toBe(true);
  });

  it("add_image_from_url fehlt ohne Schreibrecht — auch im Aufruf, nicht nur in der Liste", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read"]);

    const { json } = await rpc(f.app, token, "tools/list");
    const tools = (json as Record<string, { tools: { name: string }[] }>).result.tools;
    expect(tools.map((t) => t.name)).not.toContain("add_image_from_url");

    const { res } = await rpc(f.app, token, "tools/call", {
      name: "add_image_from_url",
      arguments: { articleId: "x", url: "https://example.com/a.png", description: "x" },
    });
    expect(res.status).toBe(403);
  });
});

/**
 * Beschreibungen NACHBESSERN. Beim Übernehmen fremder Seiten wird der
 * Alternativtext zur Bildbeschreibung — der ist meist ein Etikett
 * („Screenshot: Glossar"), keine Beschreibung. Ohne dieses Werkzeug bliebe
 * nur „Bild löschen und neu hochladen", denn die Beschreibung war bisher
 * nach dem Hochladen nirgends mehr änderbar.
 */
describe("MCP — Bildbeschreibungen nachbessern", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

  afterEach(() => vi.unstubAllGlobals());

  async function seedWithImage(f: ReturnType<typeof makeApp>, token: string) {
    vi.stubGlobal("fetch", async () =>
      new Response(PNG.slice() as unknown as BodyInit, { headers: { "content-type": "image/png" } }),
    );
    const id = await seedArticle(f.app, token, "glossare");
    const added = await callTool(f.app, token, "add_image_from_url", {
      articleId: id,
      url: "https://help.example.com/img/glossar.png",
      description: "Screenshot: Glossar",
    });
    return { id, imageId: added.data!.imageId as string };
  }

  it("ersetzt die Beschreibung, ohne das Bild anzufassen", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const { id, imageId } = await seedWithImage(f, token);
    const keysBefore = [...f.mediaObjects.keys()];

    const res = await callTool(f.app, token, "update_image_description", {
      articleId: id,
      imageId,
      description: "Liste der Glossareinträge; die Spalte Status zeigt zwei aktive Einträge.",
    });
    expect(res.isError).toBe(false);

    const article = (await f.store.listForTransfer("t_a")).find((a) => a.id === id)!;
    expect(article.images?.[0].description).toContain("Spalte Status");
    // Die Binärdatei bleibt dieselbe — es wird nichts neu hochgeladen.
    expect([...f.mediaObjects.keys()]).toEqual(keysBefore);
  });

  it("leere Beschreibung wird abgelehnt — die alte bleibt stehen", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const { id, imageId } = await seedWithImage(f, token);

    const res = await callTool(f.app, token, "update_image_description", {
      articleId: id,
      imageId,
      description: "  ",
    });
    expect(res.isError).toBe(true);
    expect(res.data!.error).toBe("image_description_required");

    const article = (await f.store.listForTransfer("t_a")).find((a) => a.id === id)!;
    expect(article.images?.[0].description).toBe("Screenshot: Glossar");
  });

  it("unbekannte Bild-Id → not_found (kein stilles Nichtstun)", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const { id } = await seedWithImage(f, token);

    const res = await callTool(f.app, token, "update_image_description", {
      articleId: id,
      imageId: "gibt-es-nicht",
      description: "Egal.",
    });
    expect(res.isError).toBe(true);
    expect(res.data!.error).toBe("not_found");
  });
});

/**
 * BEFUNDE AUS DER ERSTEN ECHTEN MIGRATION (help.smao.ai, 2026-08-28).
 * Jeder Test hält genau eine Lücke fest, die dieser Härtetest gezeigt hat.
 */
describe("MCP — Video-Werkzeuge", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  afterEach(() => vi.unstubAllGlobals());

  async function articleWithVideo(f: ReturnType<typeof makeApp>, token: string) {
    const id = await seedArticle(f.app, token, "video-artikel");
    await callTool(f.app, token, "update_article", {
      id,
      videos: [
        { id: "v1", title: "Alter Titel", description: "Alter Titel", youtubeId: "dQw4w9WgXcQ" },
        { id: "v2", title: "Zweites", description: "Zweites", youtubeId: "fiwcoTOHLyg" },
      ],
    });
    return id;
  }

  it("ändert EIN Video, ohne die anderen anzufassen", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const id = await articleWithVideo(f, token);

    const res = await callTool(f.app, token, "update_video", {
      articleId: id,
      videoId: "v1",
      description: "Zeigt, wie ein Assistent von Grund auf eingerichtet wird.",
    });
    expect(res.isError).toBe(false);

    const a = (await f.store.listForTransfer("t_a")).find((x) => x.id === id)!;
    expect(a.videos[0]).toMatchObject({
      id: "v1",
      title: "Alter Titel", // NICHT verloren gegangen
      description: "Zeigt, wie ein Assistent von Grund auf eingerichtet wird.",
      youtubeId: "dQw4w9WgXcQ",
    });
    expect(a.videos[1]).toMatchObject({ id: "v2", description: "Zweites" });
  });

  it("weist eine leere Beschreibung ab — sonst wäre das Video für die KI unsichtbar", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const id = await articleWithVideo(f, token);

    const res = await callTool(f.app, token, "update_video", { articleId: id, videoId: "v1", description: "  " });
    expect(res.isError).toBe(true);
    expect(res.data!.error).toBe("video_description_required");
  });

  it("prepare_video erfindet ohne Transkript nichts und berechnet nichts", async () => {
    // oEmbed liefert den Titel, der Transkript-Abruf scheitert (wie in echt).
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).includes("/oembed")
        ? new Response(JSON.stringify({ title: "Assistent einrichten" }))
        : new Response("nope", { status: 403 }),
    );
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);

    const res = await callTool(f.app, token, "prepare_video", {
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(res.isError).toBe(true);
    expect(res.data!.error).toBe("transcript_required");
    expect(res.data!.youtubeTitle).toBe("Assistent einrichten"); // Titel trotzdem geliefert
    expect(f.summarizerCalls).toBe(0); // keine KI, also keine Credits
  });

  it("prepare_video verdichtet ein eingefügtes Transkript", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ title: "YT-Titel" })));
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);

    const res = await callTool(f.app, token, "prepare_video", {
      youtubeUrl: "dQw4w9WgXcQ",
      transcript: "In diesem Video legen wir einen Assistenten an, vergeben einen Namen und wählen die Stimme aus.",
    });
    expect(res.isError).toBe(false);
    expect(res.data!.description).toContain("Zusammenfassung");
    expect(res.data!.youtubeTitle).toBe("YT-Titel");
    expect(f.summarizerCalls).toBe(1);
    // Ergebnis wird NICHT automatisch gespeichert — Schreiben ist ein eigener Schritt.
    const a = (await f.store.listForTransfer("t_a")).length;
    expect(a).toBe(0);
  });
});

describe("MCP — Stapel und Wiederholbarkeit", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const PAGE = `<html><head><title>Seite | Quelle</title></head><body><article>
    <h1>Seite</h1><p>Erster Absatz mit genug Text.</p>
    <img alt="Screenshot: eins" src="/a.png"><img alt="Logo" src="/b.svg">
    <h2>Leerer Abschnitt</h2></article></body></html>`;

  function stubWeb() {
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      if (u.includes("/oembed")) return new Response(JSON.stringify({ title: "T" }));
      if (u.endsWith(".png")) return new Response(PNG.slice() as unknown as BodyInit);
      if (u.endsWith(".svg")) return new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } });
      return new Response(PAGE, { headers: { "content-type": "text/html" } });
    });
  }
  afterEach(() => vi.unstubAllGlobals());

  it("setzt viele Bildbeschreibungen in EINEM Aufruf und meldet die schlechten einzeln", async () => {
    stubWeb();
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const id = await seedArticle(f.app, token, "stapel");
    const a1 = await callTool(f.app, token, "add_image_from_url", {
      articleId: id, url: "https://q.example.com/a.png", description: "Erst mal irgendwas",
    });

    const res = await callTool(f.app, token, "update_image_descriptions", {
      articleId: id,
      descriptions: [
        { imageId: a1.data!.imageId, description: "Einstellungsdialog mit aktiviertem Schalter." },
        { imageId: "gibt-es-nicht", description: "Egal" },
        { imageId: a1.data!.imageId, description: "   " },
      ],
    });
    expect(res.isError).toBe(false);
    expect(res.data!.updated).toBe(1);
    expect(res.data!.failed).toEqual([
      { imageId: "gibt-es-nicht", ok: false, error: "not_found" },
      { imageId: a1.data!.imageId, ok: false, error: "image_description_required" },
    ]);
    const art = (await f.store.listForTransfer("t_a")).find((x) => x.id === id)!;
    expect(art.images?.[0].description).toBe("Einstellungsdialog mit aktiviertem Schalter.");
  });

  it("Import ist mit on_conflict:'update' wiederholbar — ohne vorher zu löschen", async () => {
    stubWeb();
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const url = "https://q.example.com/help/seite";

    const first = await callTool(f.app, token, "import_article_from_url", { url });
    expect(first.isError).toBe(false);

    const again = await callTool(f.app, token, "import_article_from_url", { url });
    expect(again.isError).toBe(true);
    expect(again.data!.error).toBe("slug_conflict");

    const upsert = await callTool(f.app, token, "import_article_from_url", { url, on_conflict: "update" });
    expect(upsert.isError).toBe(false);
    expect(upsert.data!.status).toBe("updated");
    expect(upsert.data!.id).toBe(first.data!.id); // derselbe Artikel, kein Duplikat
    expect((await f.store.listForTransfer("t_a")).length).toBe(1);
  });

  it("nennt beim Import den GRUND je fehlgeschlagenem Bild und leere Abschnitte", async () => {
    stubWeb();
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);

    const res = await callTool(f.app, token, "import_article_from_url", {
      url: "https://q.example.com/help/seite",
    });
    expect(res.data!.imported).toMatchObject({ images: 1, imagesFailed: 1 });
    expect(res.data!.imageFailures).toEqual([
      { url: "https://q.example.com/b.svg", error: "unsupported_image_type" },
    ]);
    // Überschrift ohne Inhalt (bei fremden Seiten war das ein Kachel-Gitter):
    expect(res.data!.emptySections).toEqual(["Leerer Abschnitt"]);
  });
});
