import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // White-Label: eigene Kunden-Domains werden via Cloudflare for SaaS geroutet.
  // (Weitere Konfiguration folgt mit den Features.)
};

export default nextConfig;

// OpenNext: aktiviert Cloudflare-Bindings (D1/R2/KV/AI) bereits in `next dev`.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
