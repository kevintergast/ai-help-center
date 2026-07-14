import type { Tenant } from "./types";

/**
 * Demo-Mandanten als Nachweis der White-Label-Fähigkeit.
 * WIRD SPÄTER ERSETZT durch eine D1-Abfrage (Tabelle `tenants`) in resolve.ts.
 * Solange die D1-Ressource nicht provisioniert ist, läuft alles über diese Registry.
 */
export const DEMO_TENANTS: Tenant[] = [
  {
    id: "t_demo",
    slug: "demo",
    name: "HallofHelp Demo",
    customDomain: null,
    defaultLocale: "de",
    branding: {
      logoUrl: null,
      colorPrimary: "#4f46e5",
      colorAccent: "#06b6d4",
      colorPrimaryFg: "#ffffff",
    },
  },
  {
    id: "t_acme",
    slug: "acme",
    name: "Acme Support",
    customDomain: null,
    defaultLocale: "en",
    branding: {
      logoUrl: null,
      colorPrimary: "#e11d48",
      colorAccent: "#f59e0b",
      colorPrimaryFg: "#ffffff",
    },
  },
];

export const DEFAULT_TENANT: Tenant = DEMO_TENANTS[0];

/**
 * OPERATOR-INSTANZ (Control-Plane, Punkt 4b) — `app.hallofhelp.com`.
 * KEIN Kunden-Tenant: sie trägt Registrierung/Onboarding/„meine Hilfezentren".
 * Als eigener better-auth-Kontext (`tenantId = t_operator`) strikt isoliert.
 * Prod: die zugehörige `tenants`-Zeile wird per Migration 0006 geseedet
 * (dev/staging) bzw. real angelegt — der Slug `app` ist reserviert.
 */
export const OPERATOR_TENANT: Tenant = {
  id: "t_operator",
  slug: "app",
  name: "HallOfHelp",
  customDomain: null,
  defaultLocale: "de",
  branding: {
    logoUrl: null,
    colorPrimary: "#4f46e5",
    colorAccent: "#06b6d4",
    colorPrimaryFg: "#ffffff",
  },
};
