import Database from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { THEME_TOKEN_KEYS } from "@/lib/theme/tokens";
import { D1ContentRepository } from "@/server/content/store";
import { D1SupportRepository } from "@/server/support/store";
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
  "0005_content.sql", "0030_changelog_version.sql", "0018_article_images.sql", "0029_article_files.sql", "0019_article_translations.sql", "0024_article_flag.sql", "0034_article_sort.sql", "0035_entry_cards.sql", "0036_article_icon.sql", "0037_contact_methods.sql", "0033_api_docs_url.sql", "0038_header_actions.sql", "0043_api_docs_to_header_action.sql", "0044_prompt_suggestions.sql", "0015_support_tickets.sql", "0039_comprehension_reports.sql", "0042_review_suggestion.sql",
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
  // Frische Tenant-Objekte je Fixture — `set_theme` schreibt in das Objekt
  // (siehe getSettingsDeps unten), und ein Modul-globales Objekt würde die
  // Farbwelt eines Tests in den nächsten schleppen.
  TENANTS[HOST_A] = makeTenant("t_a", "tenant-a");
  TENANTS[HOST_B] = makeTenant("t_b", "tenant-b");
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

  const supportRepo = new D1SupportRepository(d1FromSqlite(db));

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
    getSupportDeps: async () => ({ repo: supportRepo, sendTicketMail: async () => true }),
    getApiKeyDeps: async () => ({ repo: keys }),
    getSettingsDeps: async () => ({
      setSeoIndexable: async () => {},
      setSupportEmail: async () => {},
      setDefaultLocale: async () => {},
      setShowHeaderName: async () => {},
      setWidgetOnSite: async () => {},
      setComprehensionMode: async () => {},
      setWidgetAppearance: async () => {},
      // Schreibt dorthin, wo die NÄCHSTE Anfrage liest: In Produktion löst
      // jeder Request den Tenant neu aus D1 auf, hier steht er im Objekt.
      setTheme: async (tenantId, config) => {
        const host = tenantId === "t_a" ? HOST_A : HOST_B;
        TENANTS[host] = {
          ...TENANTS[host],
          theme: config,
          ...(config
            ? {
                branding: {
                  ...TENANTS[host].branding,
                  colorPrimary: config.light["brand-primary"],
                  colorAccent: config.light["brand-accent"],
                  colorPrimaryFg: config.light["brand-primary-fg"],
                },
              }
            : {}),
        };
      },
    }),
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
    app: buildApiApp(deps), db, store, keys, indexCalls, auditEntries, mediaObjects, supportRepo,
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

/**
 * LOKALE BILDER PER MCP (`upload_image`). Anlass: Screenshots, die gerade auf
 * dem Rechner entstehen, sind unter KEINER öffentlichen Adresse erreichbar —
 * `add_image_from_url` kann sie also nie holen. Verhinderte Fehlerfälle:
 *  - Ein Aufrufer behauptet einen Inhaltstyp, der nicht zu den Bytes passt
 *    (z. B. „image/png" auf eine HTML-Datei) → wir glauben nur den BYTES.
 *  - Ein 50-MB-Base64-String landet erst im Speicher und scheitert dann am
 *    Deckel → die Länge wird VOR dem Dekodieren geprüft.
 *  - Beschreibung fehlt → Bild wäre für Screenreader und KI-Suche unsichtbar.
 */
describe("MCP — upload_image (lokale Bilder)", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

  it("nimmt Base64 an, speichert die Bytes und liefert die Bild-Id", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const id = await seedArticle(f.app, token, "screenshots");

    const res = await callTool(f.app, token, "upload_image", {
      articleId: id,
      data: b64(PNG),
      description: "Einstellungen-Dialog mit aktiviertem Schalter „Automatisch antworten“.",
    });
    expect(res.isError).toBe(false);
    expect(res.data!.bytes).toBe(PNG.byteLength);

    const imageId = res.data!.imageId as string;
    const a = (await f.store.listForTransfer("t_a")).find((x) => x.id === id)!;
    expect(a.images?.map((i) => i.id)).toContain(imageId);
    expect(a.images?.[0].description).toContain("Automatisch antworten");
    // Die Binärdatei liegt wirklich in R2 (nicht nur ein Datensatz):
    expect([...f.mediaObjects.keys()].some((k) => k.includes(imageId))).toBe(true);
  });

  it("akzeptiert auch eine data:-URI (Präfix wird abgeschnitten)", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const id = await seedArticle(f.app, token, "screenshots");

    const res = await callTool(f.app, token, "upload_image", {
      articleId: id,
      data: `data:image/png;base64,${b64(PNG)}`,
      description: "Derselbe Dialog, als data-URI übergeben.",
    });
    expect(res.isError).toBe(false);
    expect(f.mediaObjects.size).toBe(1);
  });

  it("entscheidet nach den BYTES, nicht nach der Behauptung des Aufrufers", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const id = await seedArticle(f.app, token, "screenshots");

    // Als PNG deklariert, ist aber HTML → muss abgelehnt werden.
    const res = await callTool(f.app, token, "upload_image", {
      articleId: id,
      data: `data:image/png;base64,${Buffer.from("<html>nope</html>").toString("base64")}`,
      description: "Angeblich ein PNG.",
    });
    expect(res.isError).toBe(true);
    expect(res.data!.error).toBe("unsupported_image_type");
    expect(f.mediaObjects.size).toBe(0);
  });

  it("weist zu große und kaputte Daten ab, ohne sie zu dekodieren", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const id = await seedArticle(f.app, token, "screenshots");

    for (const data of ["A".repeat(4_000_000), "kein-base64-!!!", ""]) {
      const res = await callTool(f.app, token, "upload_image", {
        articleId: id,
        data,
        description: "Egal.",
      });
      expect(res.isError).toBe(true);
      expect(res.data!.error).toBe("invalid_image_data");
    }
    expect(f.mediaObjects.size).toBe(0);
  });

  it("ohne Beschreibung abgelehnt — und ohne Schreibrecht gar nicht sichtbar", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const id = await seedArticle(f.app, token, "screenshots");

    const leer = await callTool(f.app, token, "upload_image", {
      articleId: id,
      data: b64(PNG),
      description: "   ",
    });
    expect(leer.isError).toBe(true);
    expect(leer.data!.error).toBe("image_description_required");
    expect(f.mediaObjects.size).toBe(0);

    const nurLesen = await issueKey(f.keys, "t_a", ["articles:read"]);
    const { json } = await rpc(f.app, nurLesen, "tools/list");
    const tools = (json as Record<string, { tools: { name: string }[] }>).result.tools;
    expect(tools.map((t) => t.name)).not.toContain("upload_image");
  });
});

/* ————— Navigation & Einstiegs-Karten (0034/0035) ————— */

/**
 * Verhinderte Fehlerfälle:
 *  - Ein Schlüssel, der laut eigener Zusage „nur Entwürfe" schreibt
 *    (articles:write), ändert die öffentliche Navigation.
 *  - Die KI ordnet drei Artikel und zerwürfelt dabei den Rest.
 *  - Eine Einstiegs-Karte zeigt auf einen Entwurf oder einen Tippfehler-Slug
 *    → für jeden Endnutzer ein toter Link auf der Startseite.
 *  - Eine ungültige Karte im Stapel hinterlässt einen halb ersetzten Satz.
 */
describe("MCP — Navigation", () => {
  async function seedPublished(f: ReturnType<typeof makeApp>, token: string, slug: string) {
    const id = await seedArticle(f.app, token, slug, slug);
    const pub = await callTool(f.app, token, "publish_article", { id });
    expect(pub.isError).toBe(false);
    return id;
  }

  it("reorder_articles hängt an articles:publish, NICHT an articles:write", async () => {
    const f = makeApp();
    const nurSchreiben = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const { json } = await rpc(f.app, nurSchreiben, "tools/list");
    const tools = (json as Record<string, { tools: { name: string }[] }>).result.tools;
    expect(tools.map((t) => t.name)).not.toContain("reorder_articles");

    // Unsichtbar UND gesperrt: `tools/call` lehnt mit JSON-RPC-Fehler ab,
    // nicht erst im Werkzeug (registry.ts leitet beides aus `tool.scope` ab).
    const { res, json: err } = await rpc(f.app, nurSchreiben, "tools/call", {
      name: "reorder_articles",
      arguments: { order: ["x"] },
    });
    expect(res.status).toBe(403);
    const rpcErr = (err as Record<string, Record<string, unknown>>).error;
    expect(rpcErr.code).toBe(-32602);
    expect(String(rpcErr.message)).toContain("articles:publish");
  });

  it("ordnet nach Slugs und lässt Nichtgenannte in ihrer Ordnung dahinter", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", [
      "articles:read",
      "articles:write",
      "articles:publish",
    ]);
    await seedPublished(f, token, "eins");
    await seedPublished(f, token, "zwei");
    await seedPublished(f, token, "drei");

    const res = await callTool(f.app, token, "reorder_articles", { order: ["drei"] });
    expect(res.isError).toBe(false);
    expect(res.data!.ordered).toBe(1);
    expect((res.data!.order as { slug: string }[]).map((a) => a.slug)).toEqual([
      "drei",
      "eins",
      "zwei",
    ]);

    const slugs = (await f.store.listPublishedArticles("t_a", "de")).map((a) => a.slug);
    expect(slugs).toEqual(["drei", "eins", "zwei"]);
  });

  it("nennt unbekannte Einträge beim Namen, statt sie still zu schlucken", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", [
      "articles:read",
      "articles:write",
      "articles:publish",
    ]);
    await seedPublished(f, token, "eins");

    const res = await callTool(f.app, token, "reorder_articles", { order: ["eins", "gibt-es-nicht"] });
    expect(res.isError).toBe(false);
    expect(res.data!.ignored).toEqual(["gibt-es-nicht"]);

    const keiner = await callTool(f.app, token, "reorder_articles", { order: ["nur-quatsch"] });
    expect(keiner.isError).toBe(true);
    expect(keiner.data!.error).toBe("not_found");
  });

  it("set_entry_cards ersetzt den ganzen Satz und prüft Artikel-Ziele", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", [
      "articles:read",
      "articles:write",
      "articles:publish",
      "updates:write",
    ]);
    await seedPublished(f, token, "erste-schritte");
    // Bewusst NICHT veröffentlicht — eine Karte darauf wäre ein toter Link.
    await seedArticle(f.app, token, "geheimer-entwurf", "Entwurf");

    const ok = await callTool(f.app, token, "set_entry_cards", {
      cards: [
        { kind: "article", title: "Los geht's", target: "erste-schritte" },
        { kind: "roadmap", title: "Was kommt" },
      ],
    });
    expect(ok.isError).toBe(false);
    expect(ok.data!.cards).toBe(2);
    expect(await f.store.listEntryCards("t_a")).toHaveLength(2);

    const entwurf = await callTool(f.app, token, "set_entry_cards", {
      cards: [{ kind: "article", title: "X", target: "geheimer-entwurf" }],
    });
    expect(entwurf.isError).toBe(true);
    expect(entwurf.data!.error).toBe("article_not_found");
    // Nichts angefasst: der gültige Satz von vorhin steht noch.
    expect(await f.store.listEntryCards("t_a")).toHaveLength(2);
  });

  it("eine ungültige Karte im Stapel ändert GAR NICHTS", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "updates:write"]);
    await f.store.replaceEntryCards("t_a", [
      { kind: "roadmap", title: "Bestand", description: "", target: "" },
    ]);

    const res = await callTool(f.app, token, "set_entry_cards", {
      cards: [
        { kind: "roadmap", title: "Gut" },
        { kind: "url", title: "Böse", target: "javascript:alert(1)" },
      ],
    });
    expect(res.isError).toBe(true);
    expect(res.data!.error).toBe("invalid_url");

    const cards = await f.store.listEntryCards("t_a");
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe("Bestand");
  });

  it("list_entry_cards genügt ein Lese-Schlüssel", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read"]);
    const res = await callTool(f.app, token, "list_entry_cards");
    expect(res.isError).toBe(false);
    expect(res.data!.cards).toEqual([]);
  });
});

/**
 * KONTAKTWEGE über MCP (0037). Verhinderte Fehlerfälle:
 *  - Ein Schlüssel mit reinem Schreibrecht ändert die öffentliche
 *    Kontaktseite (articles:write sagt zu: „bleibt ein Entwurf").
 *  - Eine ungültige Nummer im Stapel hinterlässt einen halb ersetzten Satz
 *    auf genau der Seite, die jemand aufruft, der nicht weiterkommt.
 *  - Das Modell erfährt nicht, dass ein leerer Satz die Seite VERSCHWINDEN
 *    lässt — und löscht sie versehentlich weg.
 */
describe("MCP — Kontaktwege", () => {
  it("set_contact_methods hängt an updates:write, nicht an articles:write", async () => {
    const f = makeApp();
    const nurSchreiben = await issueKey(f.keys, "t_a", ["articles:read", "articles:write"]);
    const { json } = await rpc(f.app, nurSchreiben, "tools/list");
    const tools = (json as Record<string, { tools: { name: string }[] }>).result.tools;
    expect(tools.map((t) => t.name)).not.toContain("set_contact_methods");
    // Lesen darf er.
    expect(tools.map((t) => t.name)).toContain("list_contact_methods");
  });

  it("setzt den ganzen Satz und meldet, ob die Seite dadurch sichtbar ist", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "updates:write"]);

    const leer = await callTool(f.app, token, "list_contact_methods");
    expect(leer.data!.pageVisible).toBe(false);

    const res = await callTool(f.app, token, "set_contact_methods", {
      methods: [
        { kind: "email", title: "Support", description: "Antwort am selben Werktag.", value: "hilfe@example.com" },
        { kind: "phone", title: "Hotline", value: "+49 30 123456" },
        { kind: "form", title: "Anliegen schildern" },
      ],
    });
    expect(res.isError).toBe(false);
    expect(res.data!.methods).toBe(3);
    expect(res.data!.pageVisible).toBe(true);

    const gespeichert = await f.store.listContactMethods("t_a");
    expect(gespeichert.map((m) => m.kind)).toEqual(["email", "phone", "form"]);
    expect(gespeichert[2].value).toBe("");
  });

  it("ein ungültiger Eintrag im Stapel ändert GAR NICHTS", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "updates:write"]);
    await f.store.replaceContactMethods("t_a", [
      { kind: "email", title: "Bestand", description: "", value: "alt@example.com" },
    ]);

    const res = await callTool(f.app, token, "set_contact_methods", {
      methods: [
        { kind: "email", title: "Gut", value: "gut@example.com" },
        { kind: "phone", title: "Böse", value: "javascript:alert(1)" },
      ],
    });
    expect(res.isError).toBe(true);
    expect(res.data!.error).toBe("invalid_phone");

    const unverändert = await f.store.listContactMethods("t_a");
    expect(unverändert.map((m) => m.title)).toEqual(["Bestand"]);
  });

  it("leerer Satz entfernt die Seite — und sagt das auch", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "updates:write"]);
    await f.store.replaceContactMethods("t_a", [
      { kind: "form", title: "Schreib uns", description: "", value: "" },
    ]);

    const res = await callTool(f.app, token, "set_contact_methods", { methods: [] });
    expect(res.isError).toBe(false);
    expect(res.data!.pageVisible).toBe(false);
    expect(String(res.data!.note)).toContain("404");
    expect(await f.store.listContactMethods("t_a")).toHaveLength(0);
  });
});

/**
 * KI MELDET EIN PROBLEM (0042). Die GRENZEN sind hier der eigentliche Wert —
 * ohne sie wäre die Funktion ein Kanal, über den eine Maschine das Postfach
 * eines Menschen fluten kann. Verhinderte Fehlerfälle:
 *  - Kein Tagesdeckel → 500 Meldungen in einer Minute, das seltene
 *    menschliche Signal ersäuft darin.
 *  - Dieselbe Stelle immer wieder → dasselbe Ergebnis, mehr Rauschen.
 *  - Meldung ohne Vorschlag → verlagerte Arbeit statt abgenommener.
 *  - Meldung auf einen ENTWURF → verrät dessen Existenz und meldet etwas,
 *    das noch niemand sehen kann.
 */
describe("MCP — KI meldet eine unklare Stelle", () => {
  const REPORT = {
    message: "Der Absatz nennt zwei Fristen, ohne zu sagen, welche für Bestandskunden gilt.",
    suggestion: "Ergänze, dass die 14-Tage-Frist nur für Neukunden gilt, Bestandskunden 30 Tage haben.",
  };

  async function publishedArticle(f: ReturnType<typeof makeApp>, token: string, slug: string) {
    const id = await seedArticle(f.app, token, slug, slug);
    await callTool(f.app, token, "publish_article", { id });
    return id;
  }

  it("legt eine Meldung an, nennt das Restkontingent und lässt den Artikel unberührt", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write", "articles:publish"]);
    const id = await publishedArticle(f, token, "fristen");

    const res = await callTool(f.app, token, "report_unclear_passage", {
      articleId: id,
      anchor: 0,
      quote: "Ein hinreichend langer Textblock.",
      ...REPORT,
    });
    expect(res.isError).toBe(false);
    expect(res.data!.created).toBe(true);
    expect(res.data!.remainingToday).toBe(19);

    const tickets = await f.supportRepo.listByTenant("t_a", 10);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ kind: "ai_review", articleId: id, anchor: 0 });
    expect(tickets[0].suggestion).toBe(REPORT.suggestion);

    // Der Artikel selbst bleibt, wie er war.
    const article = await f.store.getForEdit("t_a", id, "de");
    expect(article?.body).toHaveLength(1);
  });

  it("GRENZE: dieselbe Stelle ein zweites Mal legt NICHTS an", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write", "articles:publish"]);
    const id = await publishedArticle(f, token, "fristen");

    await callTool(f.app, token, "report_unclear_passage", { articleId: id, anchor: 0, ...REPORT });
    const zweite = await callTool(f.app, token, "report_unclear_passage", {
      articleId: id,
      anchor: 0,
      ...REPORT,
    });
    expect(zweite.isError).toBe(false);
    expect(zweite.data!.created).toBe(false);
    expect(zweite.data!.reason).toBe("already_reported");
    expect(await f.supportRepo.listByTenant("t_a", 10)).toHaveLength(1);
  });

  it("GRENZE: Tagesdeckel greift und nennt ihn beim Namen", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write", "articles:publish"]);
    const id = await publishedArticle(f, token, "fristen");

    // 20 Meldungen direkt einsetzen (der Deckel zählt je Mandant, nicht je Stelle).
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 20; i += 1) {
      await f.supportRepo.create({
        tenantId: "t_a",
        kind: "ai_review",
        message: "x".repeat(30),
        contactEmail: null,
        question: null,
        articleId: id,
        anchor: 100 + i,
        quote: null,
        suggestion: "y".repeat(30),
        actorType: "internal",
        visitorId: null,
        nowSec: now,
      });
    }

    const res = await callTool(f.app, token, "report_unclear_passage", {
      articleId: id,
      anchor: 0,
      ...REPORT,
    });
    expect(res.isError).toBe(true);
    expect(res.data!.error).toBe("daily_limit_reached");
    expect(res.data!.limit).toBe(20);
  });

  it("verlangt einen Vorschlag — „unklar“ allein reicht nicht", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write", "articles:publish"]);
    const id = await publishedArticle(f, token, "fristen");

    const ohne = await callTool(f.app, token, "report_unclear_passage", {
      articleId: id,
      anchor: 0,
      message: REPORT.message,
    });
    expect(ohne.isError).toBe(true);
    expect(ohne.data!.error).toBe("suggestion_required");

    const kurz = await callTool(f.app, token, "report_unclear_passage", {
      articleId: id,
      anchor: 0,
      message: REPORT.message,
      suggestion: "besser machen",
    });
    expect(kurz.isError).toBe(true);
    expect(kurz.data!.error).toBe("suggestion_too_short");
  });

  it("lehnt Entwürfe und nicht existierende Blöcke ab", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["articles:read", "articles:write", "articles:publish"]);
    const entwurf = await seedArticle(f.app, token, "geheim", "Entwurf");
    const id = await publishedArticle(f, token, "fristen");

    const aufEntwurf = await callTool(f.app, token, "report_unclear_passage", {
      articleId: entwurf,
      anchor: 0,
      ...REPORT,
    });
    expect(aufEntwurf.isError).toBe(true);
    expect(aufEntwurf.data!.error).toBe("article_not_found");

    const falscherBlock = await callTool(f.app, token, "report_unclear_passage", {
      articleId: id,
      anchor: 99,
      ...REPORT,
    });
    expect(falscherBlock.isError).toBe(true);
    expect(falscherBlock.data!.error).toBe("invalid_anchor");
    expect(await f.supportRepo.listByTenant("t_a", 10)).toHaveLength(0);
  });
});

/* ————— Farbwelt (0045) ————— */

/**
 * Verhinderte Fehlerfälle:
 *  - Das Werkzeug verlangt 48 Farbwerte → das Modell ERFINDET sie, und eine
 *    ungeprüfte Palette steht auf der Kundenseite. Deshalb: vier Anker,
 *    Ableitung serverseitig, und der Normalweg ist nachweislich kontrastrein.
 *  - Eine Ausnahme unterschreitet die Schwelle und verschwindet still — das
 *    Modell hielte die Farbwelt für in Ordnung.
 *  - Ein erfundener Token-Name ("background", "--page") wird ignoriert; das
 *    Modell glaubt, es hätte etwas gesetzt.
 *  - Ein Schlüssel, der laut eigener Zusage nur Inhalte pflegt, stellt das
 *    Erscheinungsbild der Instanz um.
 *  - `reset_theme` löscht die Marken-Farben mit — die sind der Rückfall.
 */
describe("MCP — Farbwelt", () => {
  const ANKER = { brand: "#b91c1c", accent: "#06b6d4", neutral: "warm", surface: "tinted" };

  it("leitet aus vier Angaben beide Modi ab — kontrastrein, ohne dass jemand Farben aufzählt", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["settings:read", "settings:write"]);

    const vorher = await callTool(f.app, token, "get_theme");
    expect(vorher.data!.active).toBe(false);

    const res = await callTool(f.app, token, "set_theme", ANKER);
    expect(res.isError).toBe(false);
    const light = res.data!.light as Record<string, string>;
    const dark = res.data!.dark as Record<string, string>;

    // Vollständig, getrennt, und nichts zu beanstanden.
    expect(Object.keys(light).sort()).toEqual([...THEME_TOKEN_KEYS].sort());
    expect(light.page).not.toBe(dark.page);
    expect(res.data!.warnings).toEqual([]);

    const nachher = await callTool(f.app, token, "get_theme");
    expect(nachher.data!.active).toBe(true);
    expect((nachher.data!.anchors as Record<string, string>).neutral).toBe("warm");
  });

  it("übernimmt eine gezielte Ausnahme — und meldet die Beanstandung, statt sie zu schlucken", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["settings:write"]);

    // Gedämpfter Text fast in Flächenfarbe: lesbar ist das nicht.
    const res = await callTool(f.app, token, "set_theme", {
      ...ANKER,
      light: { muted: "#eeeeee" },
    });
    expect(res.isError).toBe(false);
    expect((res.data!.light as Record<string, string>).muted).toBe("#eeeeee");

    const warnings = res.data!.warnings as { mode: string; pair: string }[];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((w) => w.mode === "light")).toBe(true);
    expect(warnings.map((w) => w.pair)).toContain("muted on surface");
    // Gespeichert wird trotzdem — Warnung, keine Sperre.
    expect(String(res.data!.note)).toContain("Saved");
  });

  it("lehnt einen erfundenen Token-Namen ab, statt ihn zu ignorieren", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["settings:write"]);

    for (const key of ["background", "--page", "pageColor"]) {
      const res = await callTool(f.app, token, "set_theme", { ...ANKER, light: { [key]: "#ffffff" } });
      expect(res.isError, key).toBe(true);
      expect(res.data!.error).toBe("unknown_token");
    }
  });

  it("lässt nur Hex durch — ein CSS-Schnipsel käme in einen <style>-Block", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["settings:write"]);

    const böse = await callTool(f.app, token, "set_theme", {
      ...ANKER,
      dark: { page: "red;}body{display:none" },
    });
    expect(böse.isError).toBe(true);
    expect(böse.data!.error).toBe("invalid_color");

    expect((await callTool(f.app, token, "set_theme", { ...ANKER, brand: "red" })).data!.error).toBe(
      "invalid_anchors",
    );
    expect((await callTool(f.app, token, "set_theme", { ...ANKER, neutral: "pink" })).data!.error).toBe(
      "invalid_anchors",
    );

    // Nichts davon darf etwas hinterlassen haben.
    const lesen = await issueKey(f.keys, "t_a", ["settings:read"]);
    expect((await callTool(f.app, lesen, "get_theme")).data!.active).toBe(false);
  });

  it("hängt an settings:write — ein Inhalts-Schlüssel sieht es nicht und darf es nicht", async () => {
    const f = makeApp();
    const inhalt = await issueKey(f.keys, "t_a", ["articles:read", "articles:write", "articles:publish"]);

    const { json } = await rpc(f.app, inhalt, "tools/list");
    const namen = (json as Record<string, { tools: { name: string }[] }>).result.tools.map((t) => t.name);
    expect(namen).not.toContain("set_theme");
    expect(namen).not.toContain("reset_theme");

    // Unsichtbar UND gesperrt.
    const { res } = await rpc(f.app, inhalt, "tools/call", { name: "set_theme", arguments: ANKER });
    expect(res.status).toBe(403);
  });

  it("reset_theme entfernt die Farbwelt, lässt die Marken-Farben aber stehen", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["settings:read", "settings:write"]);

    const gesetzt = await callTool(f.app, token, "set_theme", ANKER);
    const marke = (gesetzt.data!.light as Record<string, string>)["brand-primary"];

    const zurück = await callTool(f.app, token, "reset_theme");
    expect(zurück.isError).toBe(false);
    expect(zurück.data!.active).toBe(false);
    // Sie sind jetzt wieder der Rückfall — sie mitzulöschen hieße, die Instanz
    // auf fremde Standardfarben zu stellen.
    expect((zurück.data!.branding as Record<string, string>).colorPrimary).toBe(marke);
    expect((await callTool(f.app, token, "get_theme")).data!.active).toBe(false);
  });

  it("get_settings verrät, DASS es eine eigene Farbwelt gibt", async () => {
    const f = makeApp();
    const token = await issueKey(f.keys, "t_a", ["settings:read", "settings:write"]);

    // Ohne diesen Hinweis liest eine KI `branding.colorPrimary` und hält das
    // für die ganze Farbgebung.
    expect((await callTool(f.app, token, "get_settings")).data!.hasOwnColourWorld).toBe(false);
    await callTool(f.app, token, "set_theme", ANKER);
    expect((await callTool(f.app, token, "get_settings")).data!.hasOwnColourWorld).toBe(true);
  });
});
