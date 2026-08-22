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
 */
import { readFileSync, appendFileSync } from "node:fs";

const TRIES = 6;
const DELAY_MS = 5000;

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
for (let attempt = 1; attempt <= TRIES; attempt++) {
  try {
    const res = await fetch(`${target}/api/v1/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const body = res.ok ? await res.json() : null;
    last = body?.app ?? null;
    if (last?.version === expected) {
      const line = `**${target}** läuft **${last.version}** (\`${last.commit}\`, ${last.env}, gebaut ${last.builtAt})`;
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
  if (attempt < TRIES) await sleep(DELAY_MS);
}

const found = last?.version ?? "keine Antwort";
console.error(`✖ ${target} liefert ${found}, erwartet war ${expected}.`);
summary([
  "### Deployte Version — ABWEICHUNG",
  "",
  `Erwartet \`${expected}\`, gefunden \`${found}\` auf ${target}.`,
]);
process.exit(1);
