import BetterSqlite3 from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { roadmapDoc } from "@/server/search/aux-docs";
import { buildChunks } from "@/server/search/chunking";
import { toIndexable } from "@/server/search/sync";
import { findStaleAnswers } from "./staleness";

/**
 * STALENESS-Erkennung (Architektur-Kernstück). Verhinderte Fehlerfälle:
 *  - Quelle geändert/zurückgezogen/gelöscht, Antwort gilt weiter als frisch
 *    (Nutzer liest veraltete Anleitungen — genau das soll das Feature fangen).
 *  - Unveränderte Quellen markieren Antworten fälschlich als veraltet
 *    (Dauer-Banner → Feature unbrauchbar, Regenerate-Kosten ohne Grund).
 *  - Refs auf fremde Tenants gelten als frisch (Isolation).
 */

const TENANT = "t_demo";

/**
 * Absatz 1 ÜBERschreitet MAX_CHUNK_CHARS → Chunking erzeugt garantiert ZWEI
 * Chunks (sonst verschmelzen Kurz-Absätze zu einem und Index 1 existiert nie).
 */
const LONG_PARA = "Sehr ausführlicher Einladungs-Absatz. ".repeat(40);

function setup() {
  const sqlite = new BetterSqlite3(":memory:");
  applyMigrations(sqlite, ["0001_tenants.sql", "0005_content.sql", "0018_article_images.sql", "0019_article_translations.sql"]);
  const insert = sqlite.prepare(
    `INSERT INTO articles (id, tenant_id, slug, title, category, status, body_json)
     VALUES (?, ?, ?, ?, 'Test', ?, ?)`,
  );
  insert.run("a1", TENANT, "team", "Team einladen", "published", JSON.stringify([LONG_PARA, "Absatz zwei."]));
  insert.run("a2", TENANT, "andere", "Anderer Artikel", "published", JSON.stringify(["Inhalt."]));
  sqlite
    .prepare(
      `INSERT INTO roadmap_items (id, tenant_id, title, status, sort) VALUES ('r1', ?, 'Widget', 'planned', 1)`,
    )
    .run(TENANT);
  return { sqlite, env: { DB: d1FromSqlite(sqlite) } };
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

/** Referenz wie in der Produktions-Pipeline aus dem AKTUELLEN Stand bauen. */
async function refFor(articleId: string, chunkIndex = 0) {
  const chunks = await currentChunks(articleId);
  return { articleId, chunkIndex, contentHash: chunks[chunkIndex].hash };
}

async function currentChunks(articleId: string) {
  const row = ctx.sqlite
    .prepare(
      `SELECT id, slug, title, body_json, images_json, videos_json FROM articles WHERE id = ? AND tenant_id = ?`,
    )
    .get(articleId, TENANT) as {
    id: string;
    slug: string;
    title: string;
    body_json: string;
    images_json: string;
    videos_json: string;
  };
  return buildChunks(toIndexable(row));
}

describe("findStaleAnswers", () => {
  it("unveränderte Quellen → NICHT veraltet; ohne Refs → nie veraltet", async () => {
    const ref = await refFor("a1");
    const stale = await findStaleAnswers(ctx.env, TENANT, [
      { id: "ans1", refs: [ref] },
      { id: "ans2", refs: [] },
    ]);
    expect(stale).toEqual([]);
  });

  it("geänderter Quell-Absatz → veraltet (nur die betroffene Antwort)", async () => {
    const refA1 = await refFor("a1");
    const refA2 = await refFor("a2");
    ctx.sqlite
      .prepare(`UPDATE articles SET body_json = ? WHERE id = 'a1' AND tenant_id = ?`)
      .run(JSON.stringify([`${LONG_PARA} NEU.`, "Absatz zwei."]), TENANT);

    const stale = await findStaleAnswers(ctx.env, TENANT, [
      { id: "ansA", refs: [refA1] },
      { id: "ansB", refs: [refA2] },
    ]);
    expect(stale).toEqual(["ansA"]);
  });

  it("zurückgezogen/gelöscht/Chunk weg → veraltet", async () => {
    const ref = await refFor("a1", 1);
    // (a) zurückgezogen
    ctx.sqlite.prepare(`UPDATE articles SET status = 'draft' WHERE id = 'a1'`).run();
    expect(await findStaleAnswers(ctx.env, TENANT, [{ id: "x", refs: [ref] }])).toEqual(["x"]);

    // (b) wieder published, aber Artikel wurde KÜRZER (Chunk-Index existiert nicht mehr)
    ctx.sqlite
      .prepare(`UPDATE articles SET status = 'published', body_json = ? WHERE id = 'a1'`)
      .run(JSON.stringify(["Nur noch ein Absatz."]));
    expect(await findStaleAnswers(ctx.env, TENANT, [{ id: "x", refs: [ref] }])).toEqual(["x"]);

    // (c) gelöscht
    ctx.sqlite.prepare(`DELETE FROM articles WHERE id = 'a1'`).run();
    expect(await findStaleAnswers(ctx.env, TENANT, [{ id: "x", refs: [ref] }])).toEqual(["x"]);
  });

  it("Roadmap-Quelle (rm:): Status-Wechsel macht die Antwort veraltet", async () => {
    const doc = roadmapDoc({ id: "r1", title: "Widget", status: "planned" });
    const chunks = await buildChunks(doc);
    const ref = { articleId: doc.id, chunkIndex: 0, contentHash: chunks[0].hash };

    expect(await findStaleAnswers(ctx.env, TENANT, [{ id: "y", refs: [ref] }])).toEqual([]);

    ctx.sqlite.prepare(`UPDATE roadmap_items SET status = 'shipped' WHERE id = 'r1'`).run();
    expect(await findStaleAnswers(ctx.env, TENANT, [{ id: "y", refs: [ref] }])).toEqual(["y"]);
  });

  it("Tenant-Isolation: Referenz eines FREMDEN Tenants gilt als veraltet, nie als frisch", async () => {
    const ref = await refFor("a1");
    const stale = await findStaleAnswers(ctx.env, "t_other", [{ id: "z", refs: [ref] }]);
    expect(stale).toEqual(["z"]);
  });
});

describe("Bild-Beschreibungen als Quell-Kontext (Architektur: Alt-Text = KI-Kontext)", () => {
  it("geänderte/gelöschte Bild-Beschreibung macht die Antwort veraltet", async () => {
    // Bild anhängen → die Beschreibung wird Teil der Chunks (toIndexable).
    ctx.sqlite
      .prepare(`UPDATE articles SET images_json = ? WHERE id = 'a2' AND tenant_id = ?`)
      .run(JSON.stringify([{ id: "img1", description: "Screenshot des Einladungs-Dialogs" }]), TENANT);

    const chunks = await currentChunks("a2");
    const lastIndex = chunks.length - 1; // Bild-Absatz liegt im letzten Chunk
    const ref = await refFor("a2", lastIndex);
    expect(await findStaleAnswers(ctx.env, TENANT, [{ id: "b1", refs: [ref] }])).toEqual([]);

    // Beschreibung ändern → Hash kippt → veraltet.
    ctx.sqlite
      .prepare(`UPDATE articles SET images_json = ? WHERE id = 'a2' AND tenant_id = ?`)
      .run(JSON.stringify([{ id: "img1", description: "GEÄNDERTE Beschreibung" }]), TENANT);
    expect(await findStaleAnswers(ctx.env, TENANT, [{ id: "b1", refs: [ref] }])).toEqual(["b1"]);

    // Bild löschen → Chunk entfällt → ebenfalls veraltet.
    ctx.sqlite
      .prepare(`UPDATE articles SET images_json = '[]' WHERE id = 'a2' AND tenant_id = ?`)
      .run(TENANT);
    expect(await findStaleAnswers(ctx.env, TENANT, [{ id: "b1", refs: [ref] }])).toEqual(["b1"]);
  });
});

describe("Video-Beschreibungen als Quell-Kontext (Architektur: wie Bilder)", () => {
  it("geänderte Video-Beschreibung macht die Antwort veraltet", async () => {
    ctx.sqlite
      .prepare(`UPDATE articles SET videos_json = ? WHERE id = 'a2' AND tenant_id = ?`)
      .run(
        JSON.stringify([
          { id: "v1", title: "Rundgang", durationLabel: "", description: "Zeigt den Einladungs-Dialog", youtubeId: "jNQXAC9IVRw" },
        ]),
        TENANT,
      );

    const chunks = await currentChunks("a2");
    const ref = await refFor("a2", chunks.length - 1); // Video-Absatz = letzter Chunk
    expect(await findStaleAnswers(ctx.env, TENANT, [{ id: "v", refs: [ref] }])).toEqual([]);

    ctx.sqlite
      .prepare(`UPDATE articles SET videos_json = ? WHERE id = 'a2' AND tenant_id = ?`)
      .run(
        JSON.stringify([
          { id: "v1", title: "Rundgang", durationLabel: "", description: "GEÄNDERT", youtubeId: "jNQXAC9IVRw" },
        ]),
        TENANT,
      );
    expect(await findStaleAnswers(ctx.env, TENANT, [{ id: "v", refs: [ref] }])).toEqual(["v"]);
  });
});
