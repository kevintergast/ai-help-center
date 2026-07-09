import { DEMO_TENANTS, DEFAULT_TENANT } from "./registry";
import type { Tenant } from "./types";

/** Basis-Domains, unter denen Tenant-Subdomains laufen. */
const BASE_DOMAINS = ["hallofhelp.app", "hallofhelp.com", "localhost"];

/**
 * Extrahiert den Tenant-Slug aus dem Host.
 * "acme.hallofhelp.app" → "acme"; Apex/"www" → null; Custom-Domain → null (später via D1).
 */
export function tenantSlugFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0].toLowerCase().trim();

  for (const base of BASE_DOMAINS) {
    if (hostname === base) return null;
    if (hostname.endsWith(`.${base}`)) {
      const sub = hostname.slice(0, hostname.length - base.length - 1);
      const leftmost = sub.split(".")[0];
      return leftmost === "www" || leftmost === "" ? null : leftmost;
    }
  }
  return null;
}

/**
 * Löst den Tenant auf.
 * HEUTE: In-Memory-Demo-Registry.
 * SPÄTER: D1 — `SELECT * FROM tenants WHERE slug = ?1 OR custom_domain = ?2`.
 */
export async function resolveTenant(host: string | null | undefined): Promise<Tenant> {
  const slug = tenantSlugFromHost(host);
  if (!slug) return DEFAULT_TENANT;
  return DEMO_TENANTS.find((t) => t.slug === slug) ?? DEFAULT_TENANT;
}
