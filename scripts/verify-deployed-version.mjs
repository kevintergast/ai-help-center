#!/usr/bin/env node
/**
 * Deploy-Nachprüfung: fragt das Deployment, WAS es ist, und vergleicht mit
 * `package.json`.
 *
 * Läuft in CI als EIGENER Job neben dem Deploy (ci.yml `verify-production`) —
 * nicht als dessen letzter Schritt. Eine Sonde, die nichts ändert, darf einen
 * ausgelieferten Stand nicht als gescheitert ausweisen und schon gar nicht
 * seinen Release-Tag verhindern. Sie macht den Lauf rot, damit jemand hinsieht;
 * mehr kann sie ehrlicherweise nicht leisten.
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
/**
 * Warum der letzte Versuch scheiterte — „keine Antwort" allein sagte nicht, ob
 * die Domain 502 lieferte oder die Verbindung gar nicht zustande kam. Nach
 * einem Fehlschlag ist genau das die erste Frage.
 */
let lastFailure = null;
const startedAt = Date.now();
for (let attempt = 1; attempt <= TRIES; attempt++) {
  try {
    const res = await fetch(`${target}/api/v1/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const body = res.ok ? await res.json() : null;
    if (!res.ok) lastFailure = `HTTP ${res.status}`;
    last = body?.app ?? last;
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
    lastFailure = String(err?.name === "TimeoutError" ? "Zeitüberschreitung (8 s)" : (err?.message ?? err));
    console.log(`… Versuch ${attempt}/${TRIES}: ${lastFailure}`);
  }
  if (attempt < TRIES) await sleep(delayFor(attempt));
}

const waited = Math.round((Date.now() - startedAt) / 1000);
const found = last?.version ?? "keine Antwort";
// Zwei sehr verschiedene Befunde, die man nicht verwechseln darf:
//  - ANTWORT mit falscher Version  → belastbarer Hinweis auf einen Teil-Deploy.
//  - GAR KEINE Antwort             → belegt für sich genommen nichts; es kann
//    ebenso der Läufer, DNS oder eine noch nicht fertige Route sein.
const kind = last ? "falsche Version" : "keine Antwort";
console.error(
  `✖ ${target}: ${kind} (${found}), erwartet war ${expected} — ${waited} s gewartet.` +
    (lastFailure ? ` Letzter Fehlschlag: ${lastFailure}.` : ""),
);
summary([
  `### Deployte Version — ${last ? "ABWEICHUNG" : "KEINE ANTWORT"}`,
  "",
  last
    ? `${target} meldet \`${found}\`, erwartet war \`${expected}\` — nach ${waited} s.`
    : `${target} hat ${waited} s lang nicht geantwortet (erwartet war \`${expected}\`).`,
  ...(lastFailure ? ["", `Letzter Fehlschlag: \`${lastFailure}\``] : []),
  "",
  last
    ? "Eine Antwort mit der FALSCHEN Version deutet auf einen halb ausgerollten Stand hin — hier lohnt der Blick."
    : "Keine Antwort belegt für sich noch keinen kaputten Deploy: Es kann auch der Läufer, DNS oder eine noch nicht fertige Route sein. Erst prüfen, ob die Seite inzwischen antwortet.",
  "",
  "Nachprüfen: `pnpm version:deployed`",
  "Der Release-Tag hängt NICHT an diesem Job — er wird vom Deploy aus gesetzt.",
]);
process.exit(1);
