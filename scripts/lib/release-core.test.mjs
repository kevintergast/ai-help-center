import { describe, expect, it } from "vitest";
import {
  groupCommits,
  insertRelease,
  nextVersion,
  parseCommit,
  parseVersion,
  productChangelogCovers,
  recommendRelease,
  renderRelease,
  requiresProductChangelog,
} from "./release-core.mjs";

/**
 * Verhinderte Fehlerfälle:
 *  - Ein Commit ohne Conventional-Präfix verschwindet aus dem Changelog → die
 *    Release-Notizen behaupten, es sei nichts passiert (das Repo hat solche
 *    Commits, z. B. „scraping content of pages").
 *  - Ein Breaking Change bumpt in 0.x die MAJOR-Stelle → Sprung auf 1.0.0,
 *    obwohl das Produkt noch nicht dort ist.
 *  - Der Release-Block überschreibt beim Einfügen ältere Versionen oder den
 *    Dokumentkopf (Changelog-Verlust).
 */

describe("parseCommit", () => {
  it("liest type/scope/subject und ordnet den Abschnitt zu", () => {
    expect(parseCommit({ sha: "abc1234def", subject: "feat(editor): Tabellen-Block" })).toEqual({
      sha: "abc1234def",
      type: "feat",
      scope: "editor",
      subject: "Tabellen-Block",
      breaking: false,
      section: "Hinzugefügt",
    });
    expect(parseCommit({ subject: "fix: Absturz beim Speichern" })?.section).toBe("Behoben");
    expect(parseCommit({ subject: "refactor(rag): Chunker entkoppeln" })?.section).toBe("Geändert");
    expect(parseCommit({ subject: "docs: Setup ergänzen" })?.section).toBe("Wartung");
    expect(parseCommit({ subject: "fix(security): Datei-Whitelist" })?.section).toBe("Sicherheit");
  });

  it("erkennt Breaking Changes per ! und per Body", () => {
    expect(parseCommit({ subject: "feat(api)!: v1-Antwortformat geändert" })).toMatchObject({
      breaking: true,
      section: "Breaking Changes",
    });
    expect(
      parseCommit({ subject: "feat(api): Feld entfernt", body: "BREAKING CHANGE: slug entfällt" }),
    ).toMatchObject({ breaking: true, section: "Breaking Changes" });
  });

  it("behält nicht-konforme Commits unter Sonstiges (nichts unterschlagen)", () => {
    expect(parseCommit({ sha: "f00", subject: "scraping content of pages" })).toEqual({
      sha: "f00",
      type: null,
      scope: null,
      subject: "scraping content of pages",
      breaking: false,
      section: "Sonstiges",
    });
  });

  it("ignoriert Merge-Commits und Leerzeilen", () => {
    expect(parseCommit({ subject: "Merge branch 'development'" })).toBeNull();
    expect(parseCommit({ subject: "Merge pull request #12 from x" })).toBeNull();
    expect(parseCommit({ subject: "   " })).toBeNull();
  });
});

describe("Versionsstufen", () => {
  it("parseVersion wirft bei Unsinn statt still zu raten", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(() => parseVersion("v1.2")).toThrow();
  });

  it("nextVersion respektiert die explizite Stufe", () => {
    expect(nextVersion("0.3.7", "patch")).toBe("0.3.8");
    expect(nextVersion("0.3.7", "minor")).toBe("0.4.0");
    expect(nextVersion("0.3.7", "major")).toBe("1.0.0");
    expect(() => nextVersion("0.3.7", "gross")).toThrow();
  });

  // PROJEKTREGEL (docs/versioning.md): defensiv zählen. Verhinderter
  // Fehlerfall: Das Skript stuft selbstständig hoch (jedes feat = minor, jeder
  // Breaking Change = major) — dann inflationieren die Nummern und eine 1.0.0
  // entsteht aus einem Commit-Präfix statt aus einer Entscheidung.
  it("schlägt NIEMALS major vor — Breaking Change wird defensiv minor", () => {
    const breaking = [{ subject: "feat(api)!: Format geändert" }];
    for (const version of ["0.4.2", "1.4.2", "7.0.0"]) {
      const rec = recommendRelease(breaking, version);
      expect(rec.level).toBe("minor");
      expect(rec.needsJointDecision).toBe(true);
      expect(rec.reason).toMatch(/gemeinsame Entscheidung/i);
    }
  });

  it("neue Funktionen ergeben patch + Vorlage zur Beurteilung (nicht automatisch minor)", () => {
    const rec = recommendRelease(
      [{ subject: "feat(editor): Datei-Anhänge" }, { subject: "fix: Tippfehler" }],
      "0.1.0",
    );
    expect(rec.level).toBe("patch");
    expect(rec.needsJointDecision).toBe(false);
    expect(rec.features.map((f) => f.subject)).toEqual(["Datei-Anhänge"]);
    expect(rec.reason).toMatch(/MINOR nur, wenn/i);
  });

  it("nur Fixes/Wartung → patch; nichts Releasbares → level null", () => {
    const fixes = recommendRelease([{ subject: "fix: Y" }, { subject: "chore: Z" }], "0.1.0");
    expect(fixes.level).toBe("patch");
    expect(fixes.features).toEqual([]);
    expect(recommendRelease([{ subject: "Merge branch 'development'" }], "0.1.0").level).toBeNull();
    expect(recommendRelease([], "0.1.0").level).toBeNull();
  });
});

describe("Changelog-Rendering", () => {
  const commits = [
    { sha: "1111111aaa", subject: "feat(editor): Datei-Anhänge" },
    { sha: "2222222bbb", subject: "fix(widget): Loader ohne currentScript" },
    { sha: "3333333ccc", subject: "irgendwas ohne Präfix" },
    { sha: "4444444ddd", subject: "Merge branch 'development'" },
  ];

  it("gruppiert und rendert in fester Abschnitts-Reihenfolge", () => {
    const md = renderRelease({ version: "0.2.0", date: "2026-08-22", grouped: groupCommits(commits) });
    expect(md).toBe(
      [
        "## [0.2.0] – 2026-08-22",
        "",
        "### Hinzugefügt",
        "- **editor:** Datei-Anhänge (1111111)",
        "",
        "### Behoben",
        "- **widget:** Loader ohne currentScript (2222222)",
        "",
        "### Sonstiges",
        "- irgendwas ohne Präfix (3333333)",
      ].join("\n"),
    );
  });

  it("hält die Stufen-Begründung als kursive Zeile fest", () => {
    const md = renderRelease({
      version: "0.2.0",
      date: "2026-08-22",
      grouped: groupCommits([{ sha: "aaaaaaa", subject: "feat: MCP-Server" }]),
      reason: "Minor: MCP-Server als neue Fähigkeit.",
    });
    expect(md).toContain("## [0.2.0] – 2026-08-22\n\n_Minor: MCP-Server als neue Fähigkeit._");
    // Ohne Begründung keine leere Kursivzeile.
    expect(renderRelease({ version: "0.2.1", date: "2026-08-23", grouped: {}, reason: "  " })).not.toContain("__");
  });

  it("leerer Release wird benannt, nicht leer gelassen", () => {
    expect(renderRelease({ version: "0.2.1", date: "2026-08-23", grouped: {} })).toContain(
      "_Keine dokumentierten Änderungen._",
    );
  });
});

describe("insertRelease", () => {
  const doc = [
    "# Changelog",
    "",
    "Kopftext.",
    "",
    "## [Unreleased]",
    "",
    "### Hinzugefügt",
    "- **editor:** Etwas Neues (aaaaaaa)",
    "",
    "## [0.1.0] – 2026-08-01",
    "",
    "### Hinzugefügt",
    "- Erste Version (bbbbbbb)",
    "",
  ].join("\n");

  it("macht Unreleased zur Version, legt ein frisches Unreleased an und behält Ältere", () => {
    const out = insertRelease(doc, "## [0.2.0] – 2026-08-22");
    expect(out).toContain("# Changelog");
    expect(out).toContain("## [Unreleased]\n\n_Noch keine Einträge._");
    expect(out).toContain("## [0.2.0] – 2026-08-22\n\n### Hinzugefügt\n- **editor:** Etwas Neues (aaaaaaa)");
    expect(out).toContain("## [0.1.0] – 2026-08-01");
    // Reihenfolge: neu vor alt.
    expect(out.indexOf("[0.2.0]")).toBeLessThan(out.indexOf("[0.1.0]"));
  });

  it("schleppt den Platzhalter NICHT in den Release (Live-Fund 2026-08-23)", () => {
    const leer = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "_Noch keine Einträge._",
      "",
      "## [0.1.0] – 2026-08-01",
      "- alt",
      "",
    ].join("\n");
    const out = insertRelease(leer, "## [0.2.0] – 2026-08-23\n\n### Hinzugefügt\n- Neu");
    // Genau EIN Platzhalter, und der steht unter Unreleased — nicht im Release.
    expect(out.match(/_Noch keine Einträge\._/g)).toHaveLength(1);
    expect(out.indexOf("_Noch keine Einträge._")).toBeLessThan(out.indexOf("## [0.2.0]"));
    expect(out).toContain("## [0.2.0] – 2026-08-23\n\n### Hinzugefügt\n- Neu");
  });

  it("ohne Unreleased-Überschrift: Block vor der ersten Version, Kopf bleibt", () => {
    const withoutHeading = ["# Changelog", "", "Kopftext.", "", "## [0.1.0] – 2026-08-01", "- alt", ""].join("\n");
    const out = insertRelease(withoutHeading, "## [0.2.0] – 2026-08-22");
    expect(out.startsWith("# Changelog")).toBe(true);
    expect(out.indexOf("[0.2.0]")).toBeLessThan(out.indexOf("[0.1.0]"));
    expect(out).toContain("Kopftext.");
  });
});

/**
 * REGEL: jedes Minor-Release erscheint auch im PRODUKT-Changelog (Kunden-Sicht).
 * Verhinderter Fehlerfall: Die Versionsnummer zählt hoch, aber Nutzer erfahren
 * nie, was sie bekommen haben — oder das Gate greift wegen einer Teil-Übereinstimmung
 * ("0.2.0" findet "0.2.01") fälschlich.
 */
describe("Produkt-Changelog-Pflicht", () => {
  const seed = [
    "const CHANGELOG = [",
    '  { title: "Neu", description: "…", at: BASE + 10, version: "0.2.0", level: "minor" },',
    "  { title: \"Alt\", description: \"…\", at: BASE },",
    "];",
  ].join("\n");

  it("gilt für minor und major, nicht für patch", () => {
    expect(requiresProductChangelog("minor")).toBe(true);
    expect(requiresProductChangelog("major")).toBe(true);
    expect(requiresProductChangelog("patch")).toBe(false);
  });

  it("erkennt einen vorhandenen Eintrag — und akzeptiert keine Teil-Treffer", () => {
    expect(productChangelogCovers(seed, "0.2.0")).toBe(true);
    expect(productChangelogCovers(seed, "0.3.0")).toBe(false);
    // Punkt als Regex-Platzhalter würde "0x2y0" durchlassen.
    expect(productChangelogCovers('version: "0x2y0"', "0.2.0")).toBe(false);
    // Teil-Treffer: "0.2.0" darf nicht in "0.2.01" hineinlesen.
    expect(productChangelogCovers('version: "0.2.01"', "0.2.0")).toBe(false);
  });

  it("erkennt beide Anführungszeichen-Stile", () => {
    expect(productChangelogCovers("version: '1.4.0'", "1.4.0")).toBe(true);
    expect(productChangelogCovers("version: `1.4.0`", "1.4.0")).toBe(true);
  });
});
