#!/usr/bin/env node
/**
 * `pnpm changelog` — zeigt, was seit dem letzten Release-Tag passiert ist:
 * gruppierte Einträge plus die empfohlene nächste Versionsnummer.
 *
 * Schreibt NICHTS. Zum Festschreiben: `pnpm release [patch|minor|major]`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { groupCommits, recommendRelease, renderSections, nextVersion } from "./lib/release-core.mjs";

// stdio: git-Fehlermeldungen (z. B. „No names found" ohne Tags) gehören nicht
// in die Ausgabe — der Aufrufer behandelt den Fall selbst.
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** Letzter Release-Tag (vX.Y.Z) oder null, wenn noch keiner existiert. */
export function lastReleaseTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*") || null;
  } catch {
    return null; // noch kein Tag → gesamte Historie
  }
}

/**
 * Commits seit `from` (exklusiv) bis HEAD, mit Body. Trennzeichen sind
 * ASCII-Steuerzeichen, damit Commit-Texte sie nicht enthalten können.
 */
export function commitsSince(from) {
  const range = from ? `${from}..HEAD` : "HEAD";
  const raw = git("log", range, "--no-merges", "--pretty=format:%H%x1f%s%x1f%b%x1e");
  if (raw.length === 0) return [];
  return raw
    .split("\x1e")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const [sha = "", subject = "", body = ""] = chunk.split("\x1f");
      return { sha, subject, body };
    });
}

function main() {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const tag = lastReleaseTag();
  const commits = commitsSince(tag);
  const grouped = groupCommits(commits);
  const rec = recommendRelease(commits, pkg.version);

  console.log(`Aktuelle Version: ${pkg.version}`);
  console.log(`Basis:            ${tag ?? "(kein Tag — gesamte Historie)"}`);
  console.log(`Commits:          ${commits.length}\n`);

  const md = renderSections(grouped);
  console.log(md.length > 0 ? md : "_Keine Änderungen seit dem letzten Release._");

  if (!rec.level) {
    console.log("\nNichts zu releasen.");
    return;
  }

  // Defensive Voreinstellung (Projektregel): patch, sofern nichts dagegen
  // spricht. Die Substanz-Frage entscheidet ein Mensch/Claude, nicht das Skript.
  console.log(`\nVorschlag: ${rec.level} → ${nextVersion(pkg.version, rec.level)}`);
  console.log(`Grund:     ${rec.reason}`);
  if (rec.features.length > 0) {
    console.log("\nNeue Funktionen zur Beurteilung (substanziell = minor, Feinschliff = patch):");
    for (const f of rec.features) console.log(`  · ${f.scope ? f.scope + ": " : ""}${f.subject}`);
  }
  if (rec.needsJointDecision) {
    console.log("\n⚠ Breaking Change erkannt — ob daraus ein MAJOR wird, wird gemeinsam entschieden.");
  }
  console.log(`\nFestschreiben: pnpm release ${rec.level} --reason "…"`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
