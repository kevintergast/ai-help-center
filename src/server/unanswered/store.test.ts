import BetterSqlite3 from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { D1UnansweredRepository, questionKey, RETENTION_DAYS } from "./store";

/**
 * REDAKTIONS-WARTESCHLANGE (0047). Verhinderte Fehlerfälle:
 *  - Dieselbe Frage erscheint fünfmal einzeln statt einmal mit Zähler → die
 *    Liste ist unbrauchbar, gerade wenn sie wichtig wird.
 *  - Eine Meldung legt eine ZWEITE Zeile an → die Frage zählt doppelt, nur
 *    weil jemand zusätzlich um Antwort gebeten hat.
 *  - Die Aufbewahrungsfrist greift nicht → wir legen entgegen der
 *    ausdrücklichen Zusage eine dauerhafte Fragetext-Halde an.
 *  - Mandanten sehen die Fragen der jeweils anderen.
 */

const NOW = 1_800_000_000;
const DAY = 86_400;

function setup() {
  const sqlite = new BetterSqlite3(":memory:");
  applyMigrations(sqlite, ["0001_tenants.sql", "0047_unanswered_questions.sql"]);
  sqlite.prepare(`DELETE FROM tenants`).run();
  sqlite.prepare(`INSERT INTO tenants (id, slug, name) VALUES ('t_a','a','A')`).run();
  sqlite.prepare(`INSERT INTO tenants (id, slug, name) VALUES ('t_b','b','B')`).run();
  return { sqlite, repo: new D1UnansweredRepository(d1FromSqlite(sqlite)) };
}

describe("questionKey — Gruppierung", () => {
  it("fasst dieselbe Frage trotz Schreibweise zusammen", () => {
    expect(questionKey("Wie richte ich das ein?")).toBe(questionKey("wie richte ich das ein"));
    expect(questionKey("Wie  richte   ich das ein!!!")).toBe(questionKey("Wie richte ich das ein"));
  });

  it("wirft verschiedene Fragen NICHT zusammen", () => {
    expect(questionKey("Wie richte ich das ein?")).not.toBe(questionKey("Was kostet das?"));
  });
});

describe("D1UnansweredRepository", () => {
  let f: ReturnType<typeof setup>;
  beforeEach(() => {
    f = setup();
  });

  it("gruppiert Wiederholungen und zeigt den ZULETZT gestellten Wortlaut", async () => {
    await f.repo.record({ tenantId: "t_a", question: "Wie binde ich die Fritzbox ein?", nowSec: NOW });
    await f.repo.record({
      tenantId: "t_a",
      question: "wie binde ich die fritzbox ein",
      nowSec: NOW + 10,
    });
    await f.repo.record({ tenantId: "t_a", question: "Was kostet das?", nowSec: NOW + 20 });

    const groups = await f.repo.list("t_a", 10);
    expect(groups).toHaveLength(2);
    const fritz = groups.find((g) => g.count === 2)!;
    expect(fritz.question).toBe("wie binde ich die fritzbox ein");
    expect(fritz.reported).toBe(false);
  });

  it("Melden hebt den vorhandenen Eintrag an, statt doppelt zu zählen", async () => {
    await f.repo.record({ tenantId: "t_a", question: "Zeitgesteuerte Weiterleitung?", nowSec: NOW });
    await f.repo.report({
      tenantId: "t_a",
      question: "Zeitgesteuerte Weiterleitung?",
      email: "kunde@example.com",
      nowSec: NOW + 5,
    });

    const groups = await f.repo.list("t_a", 10);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(1);
    expect(groups[0].reported).toBe(true);
    expect(groups[0].emails).toEqual(["kunde@example.com"]);
  });

  it("Melden ohne vorherige Frage geht nicht verloren", async () => {
    await f.repo.report({ tenantId: "t_a", question: "Ganz neue Frage?", email: null, nowSec: NOW });
    const groups = await f.repo.list("t_a", 10);
    expect(groups).toHaveLength(1);
    expect(groups[0].reported).toBe(true);
  });

  it("sortiert Gemeldete vor Häufige", async () => {
    for (let i = 0; i < 5; i += 1) {
      await f.repo.record({ tenantId: "t_a", question: "Oft gefragt?", nowSec: NOW + i });
    }
    await f.repo.record({ tenantId: "t_a", question: "Einmal gefragt?", nowSec: NOW });
    await f.repo.report({ tenantId: "t_a", question: "Einmal gefragt?", email: null, nowSec: NOW });

    const groups = await f.repo.list("t_a", 10);
    expect(groups[0].question).toBe("Einmal gefragt?");
    expect(groups[1].count).toBe(5);
  });

  it("löscht Einträge nach der Aufbewahrungsfrist — beim nächsten Schreiben", async () => {
    const alt = NOW - (RETENTION_DAYS + 1) * DAY;
    await f.repo.record({ tenantId: "t_a", question: "Uralte Frage?", nowSec: alt });
    expect(await f.repo.list("t_a", 10)).toHaveLength(1);

    // Erst das nächste Schreiben räumt auf — die Frist ist an den Schreibpfad
    // gebunden, damit kein Cron nötig ist.
    await f.repo.record({ tenantId: "t_a", question: "Neue Frage?", nowSec: NOW });
    const groups = await f.repo.list("t_a", 10);
    expect(groups.map((g) => g.question)).toEqual(["Neue Frage?"]);
  });

  it("trennt Mandanten", async () => {
    await f.repo.record({ tenantId: "t_a", question: "Nur bei A?", nowSec: NOW });
    expect(await f.repo.list("t_b", 10)).toEqual([]);
  });
});
