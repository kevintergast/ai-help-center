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

// OpenNext: aktiviert Cloudflare-Bindings (D1/R2/KV/AI) bereits in `next dev`.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
