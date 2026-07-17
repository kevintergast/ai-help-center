import BetterSqlite3 from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { findStaleAnswers } from "@/server/answers/staleness";
import {
  D1SavedAnswersRepository,
  MAX_SAVED_ANSWERS_PER_USER,
} from "@/server/answers/store";
import { buildChunks } from "@/server/search/chunking";
import { toIndexable } from "@/server/search/sync";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";

/**
 * GESPEICHERTE ANTWORTEN end-to-end (echte 0017-DDL via sqlite, Memory-Auth).
 * Verhinderte Fehlerfälle:
 *  - Konto-Sync ohne Session erreichbar (Datenleck) oder User B liest User A.
 *  - Upsert akzeptiert Müll/übergroße Payloads (D1 als Datenhalde).
 *  - Merge-Regel kaputt: älterer Client-Stand überschreibt neueren Konto-Stand.
 *  - /answers/check leakt Nicht-Öffentliches oder ist NICHT public (anonyme
 *    local-first-Nutzer verlieren die Staleness-Prüfung).
 */

const HOST = "demo.hallofhelp.com";
const TENANTS: Record<string, Tenant> = {
  [HOST]: {
    id: "t_demo",
    slug: "demo",
    name: "Demo",
    customDomain: null,
    defaultLocale: "de",
    branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
  },
};
const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";
const PASSWORD = "correct-horse-battery";

type Row = Record<string, unknown>;

function makeFixture() {
  const sqlite = new BetterSqlite3(":memory:");
  applyMigrations(sqlite, ["0001_tenants.sql", "0005_content.sql", "0018_article_images.sql", "0019_article_translations.sql", "0017_saved_answers.sql"]);
  sqlite
    .prepare(
      `INSERT INTO articles (id, tenant_id, slug, title, category, status, body_json)
       VALUES ('a1', 't_demo', 'team', 'Team einladen', 'Start', 'published', ?)`,
    )
    .run(JSON.stringify(["Absatz eins.", "Absatz zwei."]));

  const authDb: Record<string, Row[]> = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const db = d1FromSqlite(sqlite);
  const deps: ApiDeps = {
    resolveTenant: async (host) => TENANTS[(host ?? "").split(":")[0].toLowerCase()] ?? null,
    createAuthForTenant: async () =>
      buildAuth({
        adapter: memoryAdapter(authDb)(tenantAuthOptions(TEST_SECRET)),
        secret: TEST_SECRET,
      }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
    getAnswersDeps: async () => ({
      repo: new D1SavedAnswersRepository(db),
      findStale: (tenantId, answers) => findStaleAnswers({ DB: db }, tenantId, answers),
    }),
  };
  return { app: buildApiApp(deps), sqlite, authDb };
}

type Fixture = ReturnType<typeof makeFixture>;

async function session(f: Fixture, email: string): Promise<string> {
  const post = (path: string, body: unknown) =>
    f.app.request(path, {
      method: "POST",
      headers: { host: HOST, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (await post(`${AUTH_BASE_PATH}/sign-up/email`, { email, password: PASSWORD, name: "U" }))
      .status,
  ).toBe(200);
  const user = f.authDb.auth_user.find((u) => u.email === email)!;
  user.email_verified = true;
  const signIn = await post(`${AUTH_BASE_PATH}/sign-in/email`, { email, password: PASSWORD });
  expect(signIn.status).toBe(200);
  return signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const answerBody = (id: string, savedAt: number, question = "Wie lade ich mein Team ein?") => ({
  id,
  question,
  body: ["Antwort-Absatz."],
  citations: [{ id: "a1", title: "Team einladen" }],
  sourceRefs: [],
  grounded: true,
  savedAt,
});

function req(f: Fixture, path: string, method: string, body?: unknown, cookie?: string) {
  return f.app.request(path, {
    method,
    headers: {
      host: HOST,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("Konto-Sync /api/v1/answers (Session Pflicht, user-scoped)", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it("anonym: GET/PUT/DELETE → 401 (Default-Deny), check bleibt public", async () => {
    expect((await req(f, "/api/v1/answers", "GET")).status).toBe(401);
    expect((await req(f, "/api/v1/answers/a1x", "PUT", answerBody("a1x", 1))).status).toBe(401);
    expect((await req(f, "/api/v1/answers/a1x", "DELETE")).status).toBe(401);

    const check = await req(f, "/api/v1/answers/check", "POST", {
      answers: [{ id: "a1x", refs: [] }],
    });
    expect(check.status).toBe(200);
    expect(await check.json()).toEqual({ stale: [] });
  });

  it("CRUD eigener Antworten + strikte User-Trennung", async () => {
    const alice = await session(f, "alice@example.com");
    const bob = await session(f, "bob@example.com");

    expect((await req(f, "/api/v1/answers/ax1", "PUT", answerBody("ax1", 1000), alice)).status).toBe(200);

    const aliceList = (await (await req(f, "/api/v1/answers", "GET", undefined, alice)).json()) as {
      answers: { id: string; question: string }[];
    };
    expect(aliceList.answers.map((a) => a.id)).toEqual(["ax1"]);

    // Bob sieht NICHTS von Alice und löscht auch nichts von ihr.
    const bobList = (await (await req(f, "/api/v1/answers", "GET", undefined, bob)).json()) as {
      answers: unknown[];
    };
    expect(bobList.answers).toEqual([]);
    expect((await req(f, "/api/v1/answers/ax1", "DELETE", undefined, bob)).status).toBe(200);
    const stillThere = (await (
      await req(f, "/api/v1/answers", "GET", undefined, alice)
    ).json()) as { answers: unknown[] };
    expect(stillThere.answers).toHaveLength(1);

    // Alice löscht ihre eigene.
    expect((await req(f, "/api/v1/answers/ax1", "DELETE", undefined, alice)).status).toBe(200);
    const empty = (await (await req(f, "/api/v1/answers", "GET", undefined, alice)).json()) as {
      answers: unknown[];
    };
    expect(empty.answers).toEqual([]);
  });

  it("Merge-Regel: älterer Client-Stand überschreibt den neueren Konto-Stand NICHT", async () => {
    const cookie = await session(f, "carol@example.com");
    expect(
      (await req(f, "/api/v1/answers/ax2", "PUT", answerBody("ax2", 2000, "Frage NEU"), cookie))
        .status,
    ).toBe(200);

    const staleWrite = await req(
      f,
      "/api/v1/answers/ax2",
      "PUT",
      answerBody("ax2", 1000, "Frage ALT"),
      cookie,
    );
    expect(staleWrite.status).toBe(200);
    expect(await staleWrite.json()).toMatchObject({ result: "stale_write" });

    const list = (await (await req(f, "/api/v1/answers", "GET", undefined, cookie)).json()) as {
      answers: { question: string }[];
    };
    expect(list.answers[0].question).toBe("Frage NEU");
  });

  it("Validierung: Müll → 400; id-Mismatch → 400; Limit → 409", async () => {
    const cookie = await session(f, "dave@example.com");
    expect((await req(f, "/api/v1/answers/ax3", "PUT", { id: "ax3" }, cookie)).status).toBe(400);
    expect(
      (await req(f, "/api/v1/answers/ANDERS", "PUT", answerBody("ax3", 1), cookie)).status,
    ).toBe(400);

    // Limit: Bestand direkt in D1 füllen (schnell), dann ein NEUER Upsert → 409.
    const userId = f.authDb.auth_user.find((u) => u.email === "dave@example.com")!.id as string;
    const insert = f.sqlite.prepare(
      `INSERT INTO saved_answers
         (tenant_id, user_id, id, question, body_json, citations_json, source_refs_json, grounded, saved_at, created_at, updated_at)
       VALUES ('t_demo', ?, ?, 'q', '["a"]', '[]', '[]', 1, 1, 1, 1)`,
    );
    for (let i = 0; i < MAX_SAVED_ANSWERS_PER_USER; i++) insert.run(userId, `afill${i}`);

    const over = await req(f, "/api/v1/answers/aneu", "PUT", answerBody("aneu", 5000), cookie);
    expect(over.status).toBe(409);
    expect(await over.json()).toMatchObject({ error: "saved_answers_limit_reached" });

    // Bestehende Antwort AKTUALISIEREN geht trotz vollem Konto (kein neuer Slot).
    const update = await req(f, "/api/v1/answers/afill0", "PUT", answerBody("afill0", 9000), cookie);
    expect(update.status).toBe(200);
  });

  it("/answers/check meldet veraltete Antworten anhand aktueller Hashes", async () => {
    const row = f.sqlite
      .prepare(`SELECT id, slug, title, body_json FROM articles WHERE id = 'a1'`)
      .get() as { id: string; slug: string; title: string; body_json: string };
    const chunks = await buildChunks(toIndexable(row));
    const freshRef = { articleId: "a1", chunkIndex: 0, contentHash: chunks[0].hash };

    const before = await req(f, "/api/v1/answers/check", "POST", {
      answers: [{ id: "ans1", refs: [freshRef] }],
    });
    expect(await before.json()).toEqual({ stale: [] });

    f.sqlite
      .prepare(`UPDATE articles SET body_json = ? WHERE id = 'a1'`)
      .run(JSON.stringify(["GEÄNDERT.", "Absatz zwei."]));

    const after = await req(f, "/api/v1/answers/check", "POST", {
      answers: [{ id: "ans1", refs: [freshRef] }],
    });
    expect(await after.json()).toEqual({ stale: ["ans1"] });

    // Kaputter Body → 400 (kein Orakel, keine 500er).
    expect((await req(f, "/api/v1/answers/check", "POST", { answers: [] })).status).toBe(400);
    expect(
      (
        await req(f, "/api/v1/answers/check", "POST", {
          answers: [{ id: "x", refs: [{ articleId: "a1" }] }],
        })
      ).status,
    ).toBe(400);
  });
});
