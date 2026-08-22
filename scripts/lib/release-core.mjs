/**
 * RELEASE-KERN (pure Funktionen, keine Seiteneffekte).
 *
 * Ausgelagert, damit die Regeln testbar sind: aus Conventional Commits
 * (docs/git-strategy.md) werden hier die Changelog-Abschnitte und die
 * empfohlene nächste Versionsnummer abgeleitet. Die CLI-Skripte
 * (release.mjs / changelog.mjs) machen nur Ein-/Ausgabe.
 *
 * BEWUSSTE ENTSCHEIDUNGEN:
 *  - Commits, die NICHT dem Conventional-Format folgen, werden nicht
 *    verschluckt, sondern landen unter „Sonstiges". Ein Changelog, das Arbeit
 *    unterschlägt, ist schlimmer als einer mit unsortierten Zeilen.
 *  - Merge-Commits fliegen raus (sie beschreiben keine Änderung).
 *  - DEFENSIV ZÄHLEN (Projektregel, docs/versioning.md): Vorschlag ist patch;
 *    minor nur bei substanziell neuen Fähigkeiten; MAJOR schlägt das Skript
 *    NIEMALS vor — Major/1.0 wird gemeinsam beschlossen.
 */

/** Changelog-Abschnitte in Ausgabe-Reihenfolge. */
export const SECTIONS = [
  "Breaking Changes",
  "Hinzugefügt",
  "Geändert",
  "Behoben",
  "Sicherheit",
  "Wartung",
  "Sonstiges",
];

/** Conventional-Type → Abschnitt. Unbekannte Types gelten als Wartung. */
const TYPE_SECTION = {
  feat: "Hinzugefügt",
  fix: "Behoben",
  perf: "Geändert",
  refactor: "Geändert",
  revert: "Geändert",
  style: "Wartung",
  docs: "Wartung",
  test: "Wartung",
  build: "Wartung",
  ci: "Wartung",
  chore: "Wartung",
};

const HEADER_RE = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<subject>.+)$/;

/**
 * Eine Commit-Zeile („<sha> <subject>" plus optionaler Body) auswerten.
 * `null` = bewusst ignoriert (Merge-Commit oder leer).
 */
export function parseCommit({ sha = "", subject = "", body = "" }) {
  const line = subject.trim();
  if (line.length === 0) return null;
  if (/^Merge (branch|pull request|remote-tracking)/i.test(line)) return null;

  const m = HEADER_RE.exec(line);
  const breaking = Boolean(m?.groups?.bang) || /^BREAKING CHANGE:/m.test(body);

  if (!m) {
    // Nicht-konformer Commit („scraping content of pages") — sichtbar halten.
    return { sha, type: null, scope: null, subject: line, breaking, section: "Sonstiges" };
  }
  const { type, scope, subject: text } = m.groups;
  const section = breaking
    ? "Breaking Changes"
    : scope === "security" || type === "security"
      ? "Sicherheit"
      : (TYPE_SECTION[type] ?? "Wartung");
  return { sha, type, scope: scope ?? null, subject: text.trim(), breaking, section };
}

/** Commits → { Abschnitt: Eintrag[] } (leere Abschnitte fehlen). */
export function groupCommits(commits) {
  const out = {};
  for (const raw of commits) {
    const entry = parseCommit(raw);
    if (!entry) continue;
    (out[entry.section] ??= []).push(entry);
  }
  return out;
}

/** SemVer-String → [major, minor, patch]; wirft bei Unsinn (kein stiller Fallback). */
export function parseVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!m) throw new Error(`Keine SemVer-Version: "${version}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Nächste Version für eine EXPLIZITE Stufe (der Wunsch gilt genau so). */
export function nextVersion(current, level) {
  const [major, minor, patch] = parseVersion(current);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unbekannte Stufe: "${level}" (major|minor|patch)`);
}

/**
 * VORSCHLAG für die Stufe — bewusst DEFENSIV (Projektregel: „lieber zu wenig
 * als zu viel"; die Entscheidung selbst trifft Claude, s. docs/versioning.md):
 *
 *  - Standard ist **patch**. Bugfixes und kleine Anpassungen an bestehenden
 *    Features sind der Normalfall.
 *  - **minor** nur bei substanziell neuen Fähigkeiten. Ob ein `feat` substanziell
 *    ist (MCP-Server, ein neuer Baustein-Satz) oder Feinschliff, kann ein Skript
 *    NICHT beurteilen — deshalb wird es nur GEMELDET (`features`), nicht
 *    automatisch hochgestuft.
 *  - **major NIE automatisch.** Ein erkannter Breaking Change hebt defensiv auf
 *    minor und setzt `needsJointDecision` — Major/1.0 wird gemeinsam beschlossen.
 *
 * Rückgabe `null` bei `level`: nichts zu releasen.
 */
export function recommendRelease(commits, currentVersion) {
  const entries = commits.map(parseCommit).filter(Boolean);
  parseVersion(currentVersion); // validiert früh (wirft bei Unsinn)
  if (entries.length === 0) {
    return { level: null, reason: "Keine Änderungen seit dem letzten Release.", features: [], breaking: [], needsJointDecision: false };
  }

  const breaking = entries.filter((e) => e.breaking);
  const features = entries.filter((e) => e.type === "feat" && !e.breaking);

  if (breaking.length > 0) {
    return {
      level: "minor",
      reason: `${breaking.length} Breaking Change(s) — defensiv als minor; MAJOR ist eine gemeinsame Entscheidung.`,
      features,
      breaking,
      needsJointDecision: true,
    };
  }
  if (features.length > 0) {
    return {
      level: "patch",
      reason: `${features.length} neue Funktion(en) erkannt — patch vorgeschlagen. MINOR nur, wenn darunter eine substanziell neue Fähigkeit ist (nicht Feinschliff).`,
      features,
      breaking,
      needsJointDecision: false,
    };
  }
  return {
    level: "patch",
    reason: "Nur Fixes, Anpassungen und Wartung.",
    features,
    breaking,
    needsJointDecision: false,
  };
}

/** Kurzform für Aufrufer, die nur die Stufe brauchen. */
export function recommendLevel(commits, currentVersion) {
  return recommendRelease(commits, currentVersion).level;
}

/** Eine Changelog-Zeile: „- **scope:** Betreff (sha)". */
export function renderEntry(entry) {
  const scope = entry.scope ? `**${entry.scope}:** ` : "";
  const sha = entry.sha ? ` (${entry.sha.slice(0, 7)})` : "";
  return `- ${scope}${entry.subject}${sha}`;
}

/** Gruppierte Commits → Markdown-Abschnitte (ohne Versions-Überschrift). */
export function renderSections(grouped) {
  const parts = [];
  for (const section of SECTIONS) {
    const entries = grouped[section];
    if (!entries || entries.length === 0) continue;
    parts.push(`### ${section}`, ...entries.map(renderEntry), "");
  }
  return parts.join("\n").trimEnd();
}

/**
 * Vollständiger Versionsblock für CHANGELOG.md. `reason` dokumentiert die
 * STUFEN-ENTSCHEIDUNG (warum patch/minor) direkt unter der Überschrift — so ist
 * später nachvollziehbar, wie gezählt wurde, nicht nur dass gezählt wurde.
 */
export function renderRelease({ version, date, grouped, reason = "" }) {
  const body = renderSections(grouped);
  const note = reason.trim().length > 0 ? `_${reason.trim()}_\n\n` : "";
  return `## [${version}] – ${date}\n\n${note}${body.length > 0 ? body : "_Keine dokumentierten Änderungen._"}`;
}

export const UNRELEASED_HEADING = "## [Unreleased]";
/** Platzhalter im leeren Unreleased-Abschnitt — darf NIE in einen Release wandern. */
export const UNRELEASED_PLACEHOLDER = "_Noch keine Einträge._";

/**
 * Neuen Versionsblock in ein bestehendes CHANGELOG.md einsetzen: der Inhalt
 * unter `## [Unreleased]` wird zur neuen Version, darüber entsteht ein frischer
 * (leerer) Unreleased-Abschnitt. Fehlt die Überschrift, wird der Block hinter
 * dem Dokumentkopf eingefügt — der Aufrufer verliert nie Text.
 */
export function insertRelease(changelog, releaseBlock) {
  const idx = changelog.indexOf(UNRELEASED_HEADING);
  if (idx === -1) {
    const firstRelease = changelog.search(/^## \[/m);
    const at = firstRelease === -1 ? changelog.length : firstRelease;
    return `${changelog.slice(0, at)}${releaseBlock}\n\n${changelog.slice(at)}`.trimEnd() + "\n";
  }
  const afterHeading = idx + UNRELEASED_HEADING.length;
  const rest = changelog.slice(afterHeading);
  const nextRelease = rest.search(/^## \[/m);
  const carriedRaw = (nextRelease === -1 ? rest : rest.slice(0, nextRelease)).trim();
  // Der Platzhalter ist KEIN Inhalt: sonst steht „Noch keine Einträge" mitten
  // im gerade geschriebenen Release (live aufgefallen beim ersten echten Lauf).
  const carried = carriedRaw === UNRELEASED_PLACEHOLDER ? "" : carriedRaw;
  const tail = nextRelease === -1 ? "" : rest.slice(nextRelease);

  const block = carried.length > 0 ? `${releaseBlock}\n\n${carried}` : releaseBlock;
  return (
    `${changelog.slice(0, idx)}${UNRELEASED_HEADING}\n\n${UNRELEASED_PLACEHOLDER}\n\n${block}\n\n${tail}`.trimEnd() +
    "\n"
  );
}

/**
 * REGEL (Kevin, 2026-08-23): Auf UNSERER Instanz erscheint zu jedem
 * MINOR-Release ein Eintrag im PRODUKT-Changelog (Kunden-Sicht) — mit genau
 * dieser Versionsnummer. Sonst zählt die Zahl hoch, ohne dass Nutzer erfahren,
 * was sie bekommen haben.
 *
 * Geprüft wird der Seed als Quelle der Wahrheit (scripts/seed-operator-content.mjs):
 * kommt dort `version: "<neue Version>"` vor? Patches sind ausgenommen (Fixes
 * müssen keine Mitteilung sein), Major läuft ohnehin über eine gemeinsame
 * Entscheidung.
 */
export function productChangelogCovers(seedSource, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`version:\\s*["'\`]${escaped}["'\`]`).test(seedSource);
}

/** Muss für diese Stufe ein Produkt-Changelog-Eintrag existieren? */
export function requiresProductChangelog(level) {
  return level === "minor" || level === "major";
}
