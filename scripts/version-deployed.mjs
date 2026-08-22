#!/usr/bin/env node
/**
 * `pnpm version:deployed` — beantwortet „welche Version läuft eigentlich wo?"
 *
 * Fragt die Health-Endpunkte der Umgebungen ab (Ground Truth: das Deployment
 * sagt selbst, was es ist) und stellt sie dem lokalen Stand gegenüber. Kein
 * Rätselraten über CI-Logs oder Cloudflare-Dashboards.
 *
 * Ziele überschreibbar: `pnpm version:deployed https://eigene-instanz.tld`
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DEFAULT_TARGETS = [
  { label: "Produktion", url: "https://app.hallofhelp.com" },
  { label: "Staging", url: "https://app.dev.hallofhelp.com" },
];

const TIMEOUT_MS = 8000;

async function probe(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${target.url}/api/v1/health`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { ...target, error: `HTTP ${res.status}` };
    const body = await res.json();
    return { ...target, app: body.app ?? null, api: body.api ?? body.version ?? null };
  } catch (err) {
    return { ...target, error: err.name === "AbortError" ? "Zeitüberschreitung" : String(err.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

function localState() {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const git = (...args) => {
    try {
      return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  return {
    version: pkg.version,
    commit: git("rev-parse", "--short=7", "HEAD"),
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    tag: git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"),
  };
}

function line(label, value) {
  return `  ${label.padEnd(12)} ${value}`;
}

const args = process.argv.slice(2).filter((a) => a.startsWith("http"));
const targets = args.length > 0 ? args.map((url) => ({ label: new URL(url).host, url })) : DEFAULT_TARGETS;

const local = localState();
console.log("\nLokal");
console.log(line("Version", local.version));
console.log(line("Commit", `${local.commit ?? "?"} (${local.branch ?? "?"})`));
console.log(line("Letzter Tag", local.tag ?? "— noch keiner"));

const results = await Promise.all(targets.map(probe));
for (const r of results) {
  console.log(`\n${r.label}  ${r.url}`);
  if (r.error) {
    console.log(line("Status", `nicht erreichbar (${r.error})`));
    continue;
  }
  const app = r.app ?? {};
  console.log(line("Version", app.version ?? "unbekannt"));
  console.log(line("Commit", app.commit ?? "unbekannt"));
  console.log(line("Gebaut", app.builtAt ?? "unbekannt"));
  console.log(line("Umgebung", app.env ?? "unbekannt"));
  if (app.version && app.version !== local.version) {
    console.log(line("", `⚠ weicht vom lokalen Stand ab (lokal ${local.version})`));
  }
}
console.log("");
