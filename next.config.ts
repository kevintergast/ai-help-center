import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // White-Label: eigene Kunden-Domains werden via Cloudflare for SaaS geroutet.
  // (Weitere Konfiguration folgt mit den Features.)

  // ESLint läuft als eigener CI-Job (`pnpm lint` = ESLint-CLI, Flat-Config) und ist dem
  // Build vorgelagert (build `needs: [validate]`). Das doppelte Linten während `next build`
  // ist daher redundant und wird deaktiviert (vermeidet u. a. die FlatCompat-„plugin not
  // detected"-Warnung). Typecheck bleibt im Build aktiv.
  eslint: { ignoreDuringBuilds: true },
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
