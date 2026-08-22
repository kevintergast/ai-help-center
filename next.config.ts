import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

/**
 * BUILD-INFO (Versionierung, docs/versioning.md): Version, Commit und
 * Build-Zeitpunkt werden zur BUILD-Zeit eingebacken, damit ein laufendes
 * Deployment beantworten kann, WAS es eigentlich ist (`GET /api/v1/health`).
 *
 * Warum hier und nicht als wrangler-Var: Das Build-Artefakt geht unverändert
 * nach Staging UND Prod (siehe ci.yml) — die Info muss also im Artefakt selbst
 * stecken, nicht in der Umgebung. Die Umgebung (`APP_ENV`) kommt separat aus
 * wrangler.toml und wird im Health-Endpoint dazugelegt.
 */
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

function gitCommit(): string {
  // In CI liefert GitHub den SHA; lokal fragen wir git. Ohne beides („unknown")
  // bleibt der Build gültig — die Info ist Diagnose, kein Feature-Gate.
  const fromCi = process.env.GITHUB_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  // White-Label: eigene Kunden-Domains werden via Cloudflare for SaaS geroutet.
  // (Weitere Konfiguration folgt mit den Features.)

  // ESLint läuft als eigener CI-Job (`pnpm lint` = ESLint-CLI, Flat-Config) und ist dem
  // Build vorgelagert (build `needs: [validate]`). Das doppelte Linten während `next build`
  // ist daher redundant und wird deaktiviert (vermeidet u. a. die FlatCompat-„plugin not
  // detected"-Warnung). Typecheck bleibt im Build aktiv.
  eslint: { ignoreDuringBuilds: true },

  // Zur Build-Zeit eingebacken (s. Kommentar oben) — im Worker über
  // process.env lesbar, ohne Binding und ohne Laufzeitkosten.
  env: {
    APP_VERSION: pkg.version,
    APP_COMMIT: gitCommit(),
    APP_BUILT_AT: new Date().toISOString(),
  },
};

export default nextConfig;

// OpenNext: Cloudflare-Bindings NUR im lokalen `next dev` aktivieren — NICHT beim `next build`.
// Sonst baut OpenNext für nicht-lokale Bindings (z. B. Vectorize) eine Remote-Proxy-Session zu
// Cloudflare auf; die scheitert in CI mangels Credentials (non-interaktiv, kein CLOUDFLARE_API_TOKEN
// im build-Job) mit "Could not start remote dev session" und bricht den Build ab.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
if (process.env.NODE_ENV === "development") {
  // Bindings mit `remote = true` in wrangler.toml (Vectorize hat keinen
  // Lokal-Simulator) sprechen in `next dev` die echte Staging-Ressource
  // (remoteBindings ist in getPlatformProxy standardmäßig aktiv).
  initOpenNextCloudflareForDev();
}
