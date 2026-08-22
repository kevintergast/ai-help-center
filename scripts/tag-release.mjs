#!/usr/bin/env node
/**
 * `pnpm tag` — setzt den Release-Tag zur Version aus `package.json` und pusht ihn.
 *
 * WARUM DIESES SKRIPT: Die Pipeline darf im Repo nicht schreiben (das
 * GITHUB_TOKEN steht auf read-only, und die Einstellung dafür ist nicht
 * zugänglich). Statt Tags von Hand zu tippen, macht dieser Befehl das
 * Nötige mit dem git-Zugang, den der Mensch ohnehin hat:
 *
 *   Version lesen → prüfen, dass sie zum Changelog passt → annotierten Tag
 *   setzen → pushen.
 *
 * Es wird NICHTS committet und kein Branch gepusht — nur der Tag.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const version = pkg.version;
const tag = `v${version}`;

// 1) Der Changelog muss diese Version kennen — sonst taggt man einen Stand,
//    den niemand nachlesen kann (dieselbe Regel wie das CI-Preflight).
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
if (!changelog.includes(`## [${version}]`)) {
  fail(
    `CHANGELOG.md hat keinen Abschnitt für ${version}.\n` +
      "  Erst `pnpm release <stufe>` ausführen, dann taggen.",
  );
}

// 2) Existiert der Tag schon? Dann nur noch (idempotent) pushen.
let exists = false;
try {
  git("rev-parse", "-q", "--verify", `refs/tags/${tag}`);
  exists = true;
} catch {
  exists = false;
}

// 3) Zeigt HEAD auf den Stand, der den Release beschreibt? Ein Tag auf einem
//    Zwischenstand wäre irreführend — Warnung, aber kein Abbruch (manchmal
//    folgen bewusst noch Doku-Commits).
const dirty = git("status", "--porcelain");
if (dirty.length > 0) {
  console.warn("⚠ Arbeitsbaum ist nicht sauber — der Tag zeigt auf den letzten COMMIT,\n  nicht auf deine offenen Änderungen.\n");
}

const head = git("rev-parse", "--short=7", "HEAD");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
console.log(`${tag} → ${head} (${branch})${exists ? "  [Tag existiert bereits lokal]" : ""}`);

if (dryRun) {
  console.log("\n(--dry-run: nichts gesetzt, nichts gepusht)");
  process.exit(0);
}

if (!exists) {
  git("tag", "-a", tag, "-m", tag);
  console.log(`✔ Tag ${tag} lokal gesetzt.`);
}

try {
  git("push", "origin", tag);
  console.log(`✔ Tag ${tag} auf origin gepusht.`);
} catch (err) {
  const detail = String(err.stderr ?? err.message ?? err).trim();
  // Häufigster Fall: der Tag ist schon auf origin (dann ist alles gut).
  if (/already exists|up to date/i.test(detail)) {
    console.log(`✔ Tag ${tag} war auf origin bereits vorhanden.`);
  } else {
    fail(`Push des Tags fehlgeschlagen:\n  ${detail}`);
  }
}

console.log("\nPrüfen: pnpm version:deployed");
