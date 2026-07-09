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
