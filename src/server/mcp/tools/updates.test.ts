import BetterSqlite3 from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { D1UpdatesStore } from "@/server/content/updates";
import { ALL_TOOLS, findTool, toolsFor } from "./index";
import type { ToolContext } from "./types";

/**
 * MCP-Pflege von Changelog + Roadmap. Verhinderte Fehlerfälle:
 *  - Ein Schlüssel mit `articles:write` (der ausdrücklich NICHT veröffentlichen
 *    darf) legt öffentliche Changelog-Einträge an.
 *  - Der erste Löschaufruf löscht schon (Bestätigung wäre eine Formalie).
 *  - Ein Token für Eintrag A löscht Eintrag B, oder ein Token funktioniert
 *    zweimal.
 *  - Erfundene Stufen/Status kommen durch, weil das MCP-Tool eigene
 *    Validierung mitbringt statt der gemeinsamen.
 */

const TENANT: Tenant = {
  id: "t_demo",
  slug: "demo",
  name: "Demo",
  customDomain: null,
  defaultLocale: "de",
  branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
};

/** Bestätigungs-Codec-Fake: signiert nichts, verhält sich aber wie das Original
 *  (an Subjekt gebunden, einmal verwendbar) — genau das prüfen die Tests. */
function makeConfirmations() {
  const issued = new Map<string, string>();
  let counter = 0;
  const keyOf = (s: Record<string, unknown>) => JSON.stringify(s);
  return {
    issue: async (subject: Record<string, unknown>) => {
      const token = `tok_${++counter}`;
      issued.set(token, keyOf(subject));
      return token;
    },
    consume: async (token: string, subject: Record<string, unknown>) => {
      const stored = issued.get(token);
      if (stored === undefined || stored !== keyOf(subject)) return false;
      issued.delete(token); // einmalig
      return true;
    },
  };
}

function makeCtx(store: D1UpdatesStore, scopes: string[] = ["updates:write"]) {
  const rebuilds: string[] = [];
  const ctx = {
    tenant: TENANT,
    principal: { keyId: "key_1", name: "Test-Key", scopes, tenantId: "t_demo" },
    nowSec: 1_800_000_000,
    confirmations: makeConfirmations(),
    deps: {
      getUpdatesStore: async () => store,
      getContentIndexer: async () => ({
        onContentChange: async () => {},
        rebuildTenant: async (tenantId: string) => {
          rebuilds.push(tenantId);
          return { articles: 0, chunks: 0, embedded: 0 };
        },
      }),
    },
  } as unknown as ToolContext;
  return { ctx, rebuilds };
}

const structured = (result: { structuredContent?: unknown }) =>
  result.structuredContent as Record<string, unknown>;

describe("Registrierung & Scope", () => {
  it("die fünf Pflege-Werkzeuge hängen an updates:write", () => {
    for (const name of [
      "create_changelog_entry",
      "update_changelog_entry",
      "delete_changelog_entry",
      "upsert_roadmap_item",
      "delete_roadmap_item",
    ]) {
      const tool = findTool(name);
      expect(tool, name).toBeDefined();
      expect(tool!.scope).toBe("updates:write");
    }
    expect(ALL_TOOLS.filter((t) => t.scope === "updates:write")).toHaveLength(5);
  });

  it("ein Schlüssel mit articles:write sieht sie NICHT (kein Veröffentlichen durch die Hintertür)", () => {
    const principal = { keyId: "k", name: "n", scopes: ["articles:read", "articles:write"] };
    const names = toolsFor(principal as never).map((t) => t.name);
    expect(names).not.toContain("create_changelog_entry");
    expect(names).not.toContain("upsert_roadmap_item");
    // Lesen bleibt möglich.
    expect(names).toContain("get_changelog");
  });
});

describe("Changelog-Werkzeuge", () => {
  let store: D1UpdatesStore;

  beforeEach(() => {
    const sqlite = new BetterSqlite3(":memory:");
    applyMigrations(sqlite, ["0001_tenants.sql", "0005_content.sql", "0030_changelog_version.sql"]);
    store = new D1UpdatesStore(d1FromSqlite(sqlite));
  });

  it("anlegen mit Version und Stufe; Index wird nachgezogen", async () => {
    const { ctx, rebuilds } = makeCtx(store);
    const res = await findTool("create_changelog_entry")!.handler(
      { title: "Widget", description: "Neu", version: "2.4.0", level: "minor" },
      ctx,
    );
    expect(res.isError).toBeUndefined();
    expect(structured(res)).toMatchObject({ status: "created" });
    expect((await store.listChangelog("t_demo"))[0]).toMatchObject({
      title: "Widget",
      version: "2.4.0",
      level: "minor",
    });
    expect(rebuilds).toContain("t_demo");
  });

  it("erfundene Stufe → Fehler, nichts gespeichert", async () => {
    const { ctx } = makeCtx(store);
    const res = await findTool("create_changelog_entry")!.handler(
      { title: "X", level: "huge" },
      ctx,
    );
    expect(res.isError).toBe(true);
    expect(await store.listChangelog("t_demo")).toEqual([]);
  });

  it("löschen: erster Aufruf löscht NICHT, sondern beschreibt", async () => {
    const { ctx } = makeCtx(store);
    const created = await store.createChangelog(
      "t_demo",
      { title: "Alt", description: "", version: "1.0", level: null },
      1000,
    );

    const step1 = await findTool("delete_changelog_entry")!.handler({ id: created.id }, ctx);
    const body = structured(step1);
    expect(body.status).toBe("confirmation_required");
    expect(body.confirmation_token).toBeTruthy();
    expect(body.wouldDelete).toMatchObject({ title: "Alt", version: "1.0" });
    // Nichts passiert.
    expect(await store.listChangelog("t_demo")).toHaveLength(1);

    const step2 = await findTool("delete_changelog_entry")!.handler(
      { id: created.id, confirmation_token: body.confirmation_token as string },
      ctx,
    );
    expect(structured(step2)).toMatchObject({ status: "deleted" });
    expect(await store.listChangelog("t_demo")).toEqual([]);
  });

  it("Token gilt nur einmal und nur für seinen Eintrag", async () => {
    const { ctx } = makeCtx(store);
    const a = await store.createChangelog("t_demo", { title: "A", description: "", version: null, level: null }, 1000);
    const b = await store.createChangelog("t_demo", { title: "B", description: "", version: null, level: null }, 2000);

    const issued = structured(
      await findTool("delete_changelog_entry")!.handler({ id: a.id }, ctx),
    ).confirmation_token as string;

    // Fremder Eintrag mit A-Token → abgelehnt, B bleibt.
    const wrong = await findTool("delete_changelog_entry")!.handler(
      { id: b.id, confirmation_token: issued },
      ctx,
    );
    expect(wrong.isError).toBe(true);
    expect(await store.listChangelog("t_demo")).toHaveLength(2);

    // Richtiger Eintrag → gelöscht; dasselbe Token danach wertlos.
    expect(
      structured(
        await findTool("delete_changelog_entry")!.handler({ id: a.id, confirmation_token: issued }, ctx),
      ),
    ).toMatchObject({ status: "deleted" });
    const again = await findTool("delete_changelog_entry")!.handler(
      { id: a.id, confirmation_token: issued },
      ctx,
    );
    expect(again.isError).toBe(true);
  });
});

describe("Roadmap-Werkzeug", () => {
  let store: D1UpdatesStore;

  beforeEach(() => {
    const sqlite = new BetterSqlite3(":memory:");
    applyMigrations(sqlite, ["0001_tenants.sql", "0005_content.sql", "0030_changelog_version.sql"]);
    store = new D1UpdatesStore(d1FromSqlite(sqlite));
  });

  it("upsert legt an und ändert (mit id)", async () => {
    const { ctx } = makeCtx(store);
    const created = structured(
      await findTool("upsert_roadmap_item")!.handler({ title: "Voice-Bot", status: "planned" }, ctx),
    );
    expect(created.status).toBe("created");
    const id = (created.item as { id: string }).id;

    const updated = structured(
      await findTool("upsert_roadmap_item")!.handler(
        { id, title: "Voice-Bot", status: "shipped" },
        ctx,
      ),
    );
    expect(updated.status).toBe("updated");
    expect((await store.listRoadmap("t_demo"))[0]).toMatchObject({ status: "shipped" });
  });

  it("unbekannte Id beim Ändern → Fehler statt heimlichem Neuanlegen", async () => {
    const { ctx } = makeCtx(store);
    const res = await findTool("upsert_roadmap_item")!.handler(
      { id: "rm_gibtsnicht", title: "X", status: "planned" },
      ctx,
    );
    expect(res.isError).toBe(true);
    expect(await store.listRoadmap("t_demo")).toEqual([]);
  });
});
