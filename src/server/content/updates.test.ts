import BetterSqlite3 from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import {
  D1UpdatesStore,
  validateChangelogInput,
  validateRoadmapInput,
  MAX_VERSION_CHARS,
} from "./updates";

/**
 * Verhinderte Fehlerfälle:
 *  - Eine erfundene Stufe („huge") landet in der DB und bricht das CHECK oder
 *    rendert ein leeres Badge.
 *  - Ein Titel-Fix am Changelog verschiebt ungewollt das Veröffentlichungsdatum
 *    (der Eintrag springt in der Liste nach oben).
 *  - Ein Eintrag eines anderen Mandanten ist über die eigene Instanz änder- oder
 *    löschbar (Isolations-Invariante).
 *  - Neue Roadmap-Punkte landen vorne und werfen die gepflegte Reihenfolge um.
 */

describe("validateChangelogInput", () => {
  it("nimmt Titel plus optionale Version/Stufe", () => {
    expect(validateChangelogInput({ title: "  Neu  ", description: " Text " })).toEqual({
      ok: true,
      value: { title: "Neu", description: "Text", version: null, level: null, publishedAt: undefined },
    });
    const withVersion = validateChangelogInput({
      title: "Release",
      description: "",
      version: " R25-08 ",
      level: "minor",
    });
    expect(withVersion).toMatchObject({ ok: true, value: { version: "R25-08", level: "minor" } });
  });

  it("lässt freie Versionsschemata zu (kein SemVer-Zwang)", () => {
    for (const version of ["2.4.0", "R25-08", "Frühjahr 2026", "v12"]) {
      expect(validateChangelogInput({ title: "T", version }).ok).toBe(true);
    }
    expect(validateChangelogInput({ title: "T", version: "x".repeat(MAX_VERSION_CHARS + 1) })).toEqual({
      ok: false,
      error: "invalid_version",
    });
  });

  it("weist leere Titel und erfundene Stufen ab", () => {
    expect(validateChangelogInput({ title: "   " })).toEqual({ ok: false, error: "invalid_title" });
    expect(validateChangelogInput({ title: "T", level: "huge" })).toEqual({
      ok: false,
      error: "invalid_level",
    });
    expect(validateChangelogInput({ title: "T", publishedAt: "gestern" })).toEqual({
      ok: false,
      error: "invalid_published_at",
    });
    expect(validateChangelogInput(null)).toEqual({ ok: false, error: "invalid_body" });
  });

  it("leere Version/Stufe bedeuten bewusst „ohne", () => {
    expect(validateChangelogInput({ title: "T", version: "", level: "" })).toMatchObject({
      ok: true,
      value: { version: null, level: null },
    });
  });
});

describe("validateRoadmapInput", () => {
  it("Standard-Status ist planned; unbekannter Status → Fehler", () => {
    expect(validateRoadmapInput({ title: "Idee" })).toMatchObject({
      ok: true,
      value: { title: "Idee", status: "planned" },
    });
    expect(validateRoadmapInput({ title: "Idee", status: "maybe" })).toEqual({
      ok: false,
      error: "invalid_status",
    });
  });
});

describe("D1UpdatesStore", () => {
  let sqlite: BetterSqlite3.Database;
  let store: D1UpdatesStore;

  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:");
    applyMigrations(sqlite, [
      "0001_tenants.sql",
      "0005_content.sql",
      "0030_changelog_version.sql",
    ]);
    store = new D1UpdatesStore(d1FromSqlite(sqlite));
  });

  it("Changelog: anlegen, lesen, ändern — Datum bleibt ohne publishedAt stehen", async () => {
    const created = await store.createChangelog(
      "t_demo",
      { title: "Widget", description: "Neu", version: "0.2.0", level: "minor", publishedAt: 1_700_000_000 },
      1_800_000_000,
    );
    expect(created).toMatchObject({ version: "0.2.0", level: "minor", publishedAt: 1_700_000_000 });

    const updated = await store.updateChangelog("t_demo", created.id, {
      title: "Widget (Tippfehler behoben)",
      description: "Neu",
      version: "0.2.0",
      level: "minor",
    });
    expect(updated).toMatchObject({
      title: "Widget (Tippfehler behoben)",
      publishedAt: 1_700_000_000, // NICHT umdatiert
    });

    const list = await store.listChangelog("t_demo");
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Widget (Tippfehler behoben)");
  });

  it("Changelog: neueste Einträge zuerst", async () => {
    await store.createChangelog("t_demo", { title: "alt", description: "", version: null, level: null, publishedAt: 1000 }, 0);
    await store.createChangelog("t_demo", { title: "neu", description: "", version: null, level: null, publishedAt: 2000 }, 0);
    expect((await store.listChangelog("t_demo")).map((e) => e.title)).toEqual(["neu", "alt"]);
  });

  it("Mandanten-Isolation: fremde Einträge sind nicht sichtbar, änderbar oder löschbar", async () => {
    const foreign = await store.createChangelog(
      "t_acme",
      { title: "Fremd", description: "", version: null, level: null },
      1000,
    );
    expect(await store.listChangelog("t_demo")).toEqual([]);
    expect(
      await store.updateChangelog("t_demo", foreign.id, {
        title: "Übernommen",
        description: "",
        version: null,
        level: null,
      }),
    ).toBeNull();
    expect(await store.deleteChangelog("t_demo", foreign.id)).toBe(false);
    // Beim richtigen Mandanten funktioniert beides.
    expect(await store.deleteChangelog("t_acme", foreign.id)).toBe(true);
  });

  it("Roadmap: neue Punkte gehen ans Ende, Reihenfolge bleibt erhalten", async () => {
    const first = await store.createRoadmap("t_demo", { title: "Erstes", status: "planned" });
    const second = await store.createRoadmap("t_demo", { title: "Zweites", status: "in_progress" });
    expect(second.sort).toBeGreaterThan(first.sort);
    expect((await store.listRoadmap("t_demo")).map((i) => i.title)).toEqual(["Erstes", "Zweites"]);

    // Explizite Sortierung schlägt die Automatik.
    const top = await store.createRoadmap("t_demo", { title: "Ganz oben", status: "planned", sort: -10 });
    expect(top.sort).toBe(-10);
    expect((await store.listRoadmap("t_demo"))[0].title).toBe("Ganz oben");
  });

  it("Roadmap: ändern und löschen; unbekannte Id → null/false", async () => {
    const item = await store.createRoadmap("t_demo", { title: "Idee", status: "planned" });
    expect(
      await store.updateRoadmap("t_demo", item.id, { title: "Idee", status: "shipped" }),
    ).toMatchObject({ status: "shipped" });
    expect(await store.updateRoadmap("t_demo", "rm_gibtsnicht", { title: "X", status: "planned" })).toBeNull();
    expect(await store.deleteRoadmap("t_demo", item.id)).toBe(true);
    expect(await store.deleteRoadmap("t_demo", item.id)).toBe(false);
  });
});
