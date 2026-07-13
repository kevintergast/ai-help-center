import { DEMO_TENANTS, DEFAULT_TENANT, OPERATOR_TENANT } from "./registry";
import type { Tenant } from "./types";

/** Basis-Domains, unter denen Tenant-Subdomains laufen. */
const BASE_DOMAINS = ["hallofhelp.com", "localhost"];

/**
 * Feste Slug/Id der Operator-Instanz (Control-Plane, Punkt 4b).
 * `app.hallofhelp.com` ist KEIN Kunden-Tenant, sondern die Betreiber-Instanz:
 * Registrierung/Onboarding/„meine Hilfezentren". Sie nutzt die BESTEHENDE
 * (strikt instanz-isolierte) better-auth-Maschinerie mit `tenantId = t_operator`.
 */
export const OPERATOR_SUBDOMAIN = "app";
export const OPERATOR_TENANT_ID = "t_operator";

/**
 * Reservierte Subdomains, die NIE einem Kunden-Tenant gehören.
 * - `www`  — Apex-Umleitung.
 * - `auth` — zentraler OAuth-Gateway-Host (auth.hallofhelp.com): bedient den
 *            Provider-Callback host-neutral, löst den Tenant NUR aus dem
 *            signierten state auf und darf deshalb selbst NIE zu einem Tenant
 *            kollabieren (sonst könnte ein Datensatz `tenants.slug='auth'` den
 *            Gateway-Host kapern).
 * - `api`  — reserviert für eine spätere dedizierte API-Origin.
 * - `app`  — Operator-Instanz (Punkt 4b): reserviert, damit KEIN Kunde den
 *            Control-Plane-Host `app.hallofhelp.com` per `tenants.slug='app'`
 *            kapern kann. Aufgelöst wird sie ausschließlich über
 *            `isOperatorHost` (nicht über den generischen Slug-Pfad).
 */
const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www",
  "auth",
  "api",
  OPERATOR_SUBDOMAIN,
]);

/**
 * Ist der Host die Operator-Instanz (`app.<base>`)? Host-neutral wie
 * `isGatewayHost`: nur der linkeste Subdomain-Teil `app` unter einer bekannten
 * Basis-Domain zählt (kein Vertrauen in tenants-Daten). Wird von Auflösung UND
 * Operator-Guards genutzt, damit es EINE Quelle für „Operator-Kontext" gibt.
 */
export function isOperatorHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0].toLowerCase().trim();
  return BASE_DOMAINS.some((base) => hostname === `${OPERATOR_SUBDOMAIN}.${base}`);
}

/**
 * Extrahiert den Tenant-Slug aus dem Host.
 * "acme.hallofhelp.com" → "acme"; Apex/reservierte Subdomain (www/auth/api) →
 * null; Custom-Domain → null (später via D1).
 */
export function tenantSlugFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0].toLowerCase().trim();

  for (const base of BASE_DOMAINS) {
    if (hostname === base) return null;
    if (hostname.endsWith(`.${base}`)) {
      const sub = hostname.slice(0, hostname.length - base.length - 1);
      const leftmost = sub.split(".")[0];
      return leftmost === "" || RESERVED_SUBDOMAINS.has(leftmost) ? null : leftmost;
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
  // Operator-Host zuerst (Punkt 4b): `app.<base>` → Operator-Instanz, NIE ein
  // Kunden-Tenant. Läuft VOR der Slug-Auflösung (dort ist `app` reserviert).
  if (isOperatorHost(host)) return OPERATOR_TENANT;
  const slug = tenantSlugFromHost(host);
  if (!slug) return DEFAULT_TENANT;
  return DEMO_TENANTS.find((t) => t.slug === slug) ?? DEFAULT_TENANT;
}
