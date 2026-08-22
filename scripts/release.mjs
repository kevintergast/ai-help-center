#!/usr/bin/env node
/**
 * `pnpm release [patch|minor|major] [--dry-run]`
 *
 * Schreibt einen Release FEST: hebt `package.json`, verschiebt den
 * Unreleased-Abschnitt in einen datierten Versionsblock in `CHANGELOG.md` und
 * ergänzt fehlende Einträge aus den Commits seit dem letzten Tag.
 *
 * COMMIT UND TAG MACHT DER MENSCH: Das Skript gibt die Befehle nur aus. So
 * bleibt die Release-Entscheidung (und die Signatur) beim Menschen — passend
 * zur Branch-Protection (nie direkt auf main pushen, siehe docs/git-strategy.md).
 *
 * STUFEN-REGEL (Projektregel, docs/versioning.md): Es wird DEFENSIV gezählt —
 * patch für Bugfixes und kleine Anpassungen, minor nur für substanziell neue
 * Fähigkeiten, MAJOR nur nach gemeinsamer Entscheidung. Ohne Angabe nimmt das
 * Skript den defensiven Vorschlag; `major` verlangt zusätzlich `--confirm-major`,
 * damit ein Versehen nicht in einer 1.0.0 endet.
 *
 * Mit `--reason "…"` wird die Begründung der Stufe im CHANGELOG festgehalten.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  groupCommits,
  insertRelease,
  nextVersion,
  productChangelogCovers,
  recommendRelease,
  renderRelease,
  requiresProductChangelog,
} from "./lib/release-core.mjs";
import { commitsSince, lastReleaseTag } from "./changelog.mjs";

const PKG_URL = new URL("../package.json", import.meta.url);
const CHANGELOG_URL = new URL("../CHANGELOG.md", import.meta.url);

/** Heute als YYYY-MM-DD (lokale Zeitzone — das Datum steht im Changelog). */
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const confirmMajor = args.includes("--confirm-major");
  // Ausnahme, wenn der Eintrag direkt in der Instanz gepflegt wurde (nicht im Seed).
  const skipProductChangelog = args.includes("--skip-product-changelog");
  const level = args.find((a) => ["patch", "minor", "major"].includes(a));
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx >= 0 ? (args[reasonIdx + 1] ?? "") : "";

  const pkgRaw = readFileSync(PKG_URL, "utf8");
  const pkg = JSON.parse(pkgRaw);
  const tag = lastReleaseTag();
  const commits = commitsSince(tag);

  const rec = recommendRelease(commits, pkg.version);
  const chosen = level ?? rec.level;
  if (!chosen) {
    fail("Keine Änderungen seit dem letzten Release — nichts zu tun.");
  }

  // MAJOR ist eine gemeinsame Entscheidung (Projektregel) — ein Tippfehler darf
  // nicht in einer 1.0.0 enden.
  if (chosen === "major" && !confirmMajor) {
    fail(
      "MAJOR wird gemeinsam beschlossen (docs/versioning.md).\n" +
        "  Wenn das wirklich abgestimmt ist: pnpm release major --confirm-major --reason \"…\"",
    );
  }
  if (chosen !== "major" && rec.needsJointDecision) {
    console.warn(`⚠ ${rec.reason}\n`);
  }
  const version = nextVersion(pkg.version, chosen);

  // REGEL: Minor (und Major) brauchen einen PRODUKT-Changelog-Eintrag mit
  // dieser Version — die Nutzer-Sicht, nicht diese technische Liste.
  if (requiresProductChangelog(chosen) && !skipProductChangelog) {
    const seed = readFileSync(new URL("./seed-operator-content.mjs", import.meta.url), "utf8");
    if (!productChangelogCovers(seed, version)) {
      fail(
        [
          `${chosen.toUpperCase()}-Release ${version} hat keinen Eintrag im PRODUKT-Changelog.`,
          "",
          "  Regel (docs/versioning.md): Was Nutzer bekommen, erfahren sie im",
          "  Hilfezentrum — nicht nur in CHANGELOG.md.",
          "",
          "  Trage in scripts/seed-operator-content.mjs im Array CHANGELOG ein:",
          "    {",
          '      title: "…", description: "…",',
          `      at: BASE + …, version: "${version}", level: "${chosen}",`,
          "    }",
          "",
          "  Danach erneut ausführen. (Alternativ direkt im Verwaltungsbereich",
          "  unter Updates pflegen — dann hier mit --skip-product-changelog.)",
        ].join("\n"),
      );
    }
  }

  // Arbeitsbaum-Warnung: Ein Release mit halbfertigen Änderungen im Baum ist
  // fast immer ein Versehen (der Tag zeigt dann auf einen anderen Stand).
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  if (dirty.length > 0 && !dryRun) {
    console.warn(
      "⚠ Arbeitsbaum ist nicht sauber. Der Release wird geschrieben, aber committe\n" +
        "  bewusst nur, was zu dieser Version gehört.\n",
    );
  }

  const block = renderRelease({
    version,
    date: today(),
    grouped: groupCommits(commits),
    // Ohne --reason bleibt die Zeile weg (nichts erfinden).
    reason: reason || (level ? "" : rec.reason),
  });
  const changelog = readFileSync(CHANGELOG_URL, "utf8");
  const nextChangelog = insertRelease(changelog, block);
  const nextPkg = pkgRaw.replace(/("version":\s*)"[^"]+"/, `$1"${version}"`);
  if (nextPkg === pkgRaw) fail('In package.json wurde kein "version"-Feld gefunden.');

  console.log(
    `${pkg.version} → ${version}  (${chosen}${level ? "" : ", Vorschlag"}, Basis ${tag ?? "Projektstart"})\n`,
  );
  console.log(block);

  if (dryRun) {
    console.log("\n(--dry-run: nichts geschrieben)");
    return;
  }

  writeFileSync(PKG_URL, nextPkg);
  writeFileSync(CHANGELOG_URL, nextChangelog);

  console.log(
    [
      "",
      "✔ package.json und CHANGELOG.md aktualisiert.",
      "",
      "Nächste Schritte (bewusst manuell):",
      "  1. CHANGELOG.md durchlesen und Formulierungen für Leser glätten",
      `  2. git add package.json CHANGELOG.md && git commit -m "chore(release): v${version}"`,
      `  3. git tag -a v${version} -m "v${version}"`,
      "  4. Merge nach main (Staging zuerst) und `git push --follow-tags`",
      "  5. Nach dem Deploy prüfen: pnpm version:deployed",
      "  6. Kundenrelevantes zusätzlich in den PRODUKT-Changelog:",
      "     scripts/seed-operator-content.mjs (Array CHANGELOG) — das ist die",
      "     Sicht der Nutzer, nicht diese technische Liste.",
      "",
    ].join("\n"),
  );
}

main();
