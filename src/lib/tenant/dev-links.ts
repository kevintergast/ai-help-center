import { DEMO_TENANTS } from "./registry";

const BASE_DOMAINS = ["hallofhelp.app", "hallofhelp.com", "localhost"];

export interface TenantLink {
  slug: string;
  name: string;
  url: string;
  active: boolean;
}

/**
 * Baut absolute Wechsel-Links zu den (Demo-)Tenants auf ihren eigenen Subdomains.
 * Wechseln = echte Host-Navigation → jeder Tenant bleibt ein eigener Origin (saubere Trennung).
 * Nur für den Dev-Switcher gedacht.
 */
export function getTenantSwitchLinks(host: string | null | undefined, scheme: string): TenantLink[] {
  const raw = (host ?? "localhost:3000").toLowerCase();
  const [hostname, port] = raw.split(":");

  let base = "localhost";
  let currentSlug: string | null = null;
  for (const b of BASE_DOMAINS) {
    if (hostname === b) {
      base = b;
      break;
    }
    if (hostname.endsWith(`.${b}`)) {
      base = b;
      const leftmost = hostname.slice(0, hostname.length - b.length - 1).split(".")[0];
      currentSlug = leftmost === "www" || leftmost === "" ? null : leftmost;
      break;
    }
  }

  const portSuffix = port ? `:${port}` : "";
  return DEMO_TENANTS.map((t) => ({
    slug: t.slug,
    name: t.name,
    url: `${scheme}://${t.slug}.${base}${portSuffix}`,
    active: t.slug === currentSlug,
  }));
}
