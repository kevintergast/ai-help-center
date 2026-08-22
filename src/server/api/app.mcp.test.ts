import Database from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
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
    getContentDeps: async () => ({ store, media: {} as never }),
    getApiKeyDeps: async () => ({ repo: keys }),
    getConfirmations: async (tenantId) =>
      makeConfirmationCodec({
        secret: `${TEST_SECRET}:${tenantId}`,
        now: () => Math.floor(Date.now() / 1000),
        store: confirmStore,
      }),
    getContentIndexer: async () => ({
      onContentChange: async (_t, articleId) => void indexCalls.push(articleId),
      rebuildTenant: async () => ({ articles: 0, chunks: 0, embedded: 0 }),
    }),
  };

  return { app: buildApiApp(deps), db, store, keys, indexCalls, auditEntries };
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
