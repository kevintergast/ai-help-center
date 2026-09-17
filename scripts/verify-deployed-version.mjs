#!/usr/bin/env node
/**
 * Deploy-Nachprüfung (CI, nach `wrangler deploy`): fragt das Deployment, WAS es
 * ist, und vergleicht mit `package.json`. Läuft die erwartete Version nicht,
 * bricht der Job — ein halb ausgerollter Stand soll nicht als Erfolg gelten.
 *
 * Aufruf: node scripts/verify-deployed-version.mjs https://app.hallofhelp.com
 *
 * Cloudflare braucht nach dem Deploy einen Moment, bis die neue Version global
 * antwortet — deshalb einige Versuche mit Pause statt eines harten Fehlschlags.
 *
 * FENSTER: ~3 Minuten (LIVE-FUND 2026-09-15). Vorher waren es 6 Versuche à 5 s,
 * also 25 Sekunden — der Prod-Deploy von v0.3.0 war da noch nicht global
 * ausgerollt und der Schritt wurde ROT, obwohl der Deploy sauber war. Das ist
 * die teuerste Sorte Fehlalarm: Sie nimmt der Prüfung den Sinn (man gewöhnt
 * sich an, sie zu ignorieren) und hängt den Release-Tag ab, weil `tag-release`
 * an diesem Job hängt.
 *
 * Wartezeit steigt an (5 s → 15 s): Die ersten Versuche kosten wenig, falls
 * es doch schnell geht; die späteren geben Cloudflare echte Zeit.
 */
import { readFileSync, appendFileSync } from "node:fs";

const TRIES = 18;
const DELAY_MIN_MS = 5000;
const DELAY_MAX_MS = 15000;
/** Versuch 1..18 → 5 s, 6 s, 7 s … gedeckelt bei 15 s (Summe ≈ 3,5 min). */
const delayFor = (attempt) => Math.min(DELAY_MIN_MS + (attempt - 1) * 1000, DELAY_MAX_MS);

const target = process.argv[2];
if (!target) {
  console.error("Aufruf: node scripts/verify-deployed-version.mjs <basis-url>");
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const expected = pkg.version;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Job-Summary (GitHub) — bleibt auch nach dem Lauf sichtbar. */
function summary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    appendFileSync(file, `${lines.join("\n")}\n`);
  } catch {
    /* Summary ist Komfort, kein Grund für einen Fehlschlag */
  }
}

let last = null;
const startedAt = Date.now();
for (let attempt = 1; attempt <= TRIES; attempt++) {
  try {
    const res = await fetch(`${target}/api/v1/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const body = res.ok ? await res.json() : null;
    last = body?.app ?? null;
    if (last?.version === expected) {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      const line = `**${target}** läuft **${last.version}** (\`${last.commit}\`, ${last.env}, gebaut ${last.builtAt}) — nach ${secs} s`;
      console.log(`✔ ${line}`);
      summary(["### Deployte Version", "", line]);
      process.exit(0);
    }
    console.log(
      `… Versuch ${attempt}/${TRIES}: erwartet ${expected}, gefunden ${last?.version ?? `HTTP ${res.status}`}`,
    );
  } catch (err) {
    console.log(`… Versuch ${attempt}/${TRIES}: ${err.message ?? err}`);
  }
  if (attempt < TRIES) await sleep(delayFor(attempt));
}

const found = last?.version ?? "keine Antwort";
const waited = Math.round((Date.now() - startedAt) / 1000);
console.error(`✖ ${target} liefert ${found}, erwartet war ${expected} (${waited} s gewartet).`);
summary([
  "### Deployte Version — ABWEICHUNG",
  "",
  `Erwartet \`${expected}\`, gefunden \`${found}\` auf ${target} — nach ${waited} s.`,
  "",
  "Läuft die erwartete Version inzwischen doch, war nur das Zeitfenster zu kurz:",
  "`pnpm version:deployed` prüft es nach, `pnpm tag` zieht den Release-Tag nach.",
]);
process.exit(1);
