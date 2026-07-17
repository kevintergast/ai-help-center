/**
 * VALIDIERUNG der Operator-Provisioning-Eingaben (Punkt 4b) — von Hand, kein Zod
 * (Projektkonvention). Der Slug wird zur Subdomain `<slug>.hallofhelp.com` und
 * ist Teil des `tenants`-Datensatzes (UNIQUE) — deshalb strikt und fail-closed.
 */

import { isHexColor } from "@/server/branding/validate";
import { OPERATOR_SUBDOMAIN } from "@/lib/tenant/resolve";

/** Locales, die ein neues Hilfezentrum als Default tragen darf. */
export type NewLocale = "de" | "en";

/**
 * Slug-Format: DNS-Label-tauglich, klein. 3–63 Zeichen, nur a–z/0–9/Bindestrich,
 * KEIN führender/abschließender Bindestrich und KEINE doppelten Bindestriche
 * (letzteres verhindert verwirrende/kollidierende Labels wie `a--b`).
 */
const SLUG_RE = /^[a-z0-9](?:-?[a-z0-9])*$/;
const SLUG_MIN = 3;
const SLUG_MAX = 63;

/**
 * Reservierte/gesperrte Slugs. Enthält die host-reservierten Subdomains
 * (www/auth/api/app — siehe RESERVED_SUBDOMAINS in resolve.ts) PLUS eine
 * betriebliche Blockliste (Marken-/Rollen-/Infrastruktur-Namen), die kein Kunde
 * beanspruchen darf. Bewusst hier dupliziert gepflegt (der Provisioning-Layer
 * ist der Ort, an dem ein Slug ERSTMALS vergeben wird).
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // host-reserviert (resolve.ts RESERVED_SUBDOMAINS):
  "www",
  "auth",
  "api",
  OPERATOR_SUBDOMAIN, // "app"
  // betriebliche Blockliste:
  "admin",
  "dashboard",
  "console",
  "operator",
  "billing",
  "help",
  "support",
  "status",
  "mail",
  "smtp",
  "static",
  "assets",
  "cdn",
  "blog",
  "docs",
  "hallofhelp",
]);

/** Warum ein Slug abgelehnt wird (stabile, englische Codes). */
export type SlugRejection = "invalid_format" | "reserved";

/** Prüft NUR Format + Reservierung (keine DB). `null` = zulässig (Format-seitig). */
export function checkSlug(slug: unknown): SlugRejection | null {
  if (typeof slug !== "string") return "invalid_format";
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return "invalid_format";
  if (!SLUG_RE.test(slug)) return "invalid_format";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}

/** Validierte, provisionierbare Hilfezentrums-Eingabe (ohne Slug-Kollision). */
export interface HelpCenterInput {
  name: string;
  slug: string;
  defaultLocale: NewLocale;
  colorPrimary: string | null;
  colorAccent: string | null;
  /** Suchmaschinen-Indexierung (Wizard-Abfrage; Default true, Migration 0013). */
  seoIndexable: boolean;
}

/** Fehlercode einer verworfenen Create-Eingabe (Route → 400/…). */
export type CreateRejection =
  | "invalid_name"
  | "invalid_slug"
  | "invalid_locale"
  | "invalid_color"
  | "invalid_seo_indexable";

/**
 * Parst den Create-Body. Gibt die validierte Eingabe ODER einen stabilen
 * Fehlercode zurück. Slug-KOLLISION (bereits vergeben) ist NICHT hier, sondern
 * autoritativ am UNIQUE-Index (Repository) → 409 slug_taken.
 */
export function parseHelpCenterInput(body: unknown): HelpCenterInput | CreateRejection {
  if (typeof body !== "object" || body === null) return "invalid_name";
  const b = body as Record<string, unknown>;

  if (typeof b.name !== "string") return "invalid_name";
  const name = b.name.trim();
  if (name.length < 2 || name.length > 80) return "invalid_name";

  const slugCheck = checkSlug(b.slug);
  if (slugCheck) return "invalid_slug";

  if (b.defaultLocale !== "de" && b.defaultLocale !== "en") return "invalid_locale";

  // Farben optional; wenn gesetzt, müssen sie strikte Hex-Werte sein (kein
  // CSS-Injection — dieselbe Whitelist wie Branding).
  let colorPrimary: string | null = null;
  let colorAccent: string | null = null;
  if (b.colorPrimary !== undefined && b.colorPrimary !== null && b.colorPrimary !== "") {
    if (!isHexColor(b.colorPrimary)) return "invalid_color";
    colorPrimary = b.colorPrimary;
  }
  if (b.colorAccent !== undefined && b.colorAccent !== null && b.colorAccent !== "") {
    if (!isHexColor(b.colorAccent)) return "invalid_color";
    colorAccent = b.colorAccent;
  }

  // Indexierung: optional, strikt boolesch (fehlend = true — öffentliche
  // Hilfezentren sollen ranken; das Opt-out ist die bewusste Ausnahme).
  if (b.seoIndexable !== undefined && typeof b.seoIndexable !== "boolean") {
    return "invalid_seo_indexable";
  }
  const seoIndexable = b.seoIndexable !== false;

  return {
    name,
    slug: b.slug as string,
    defaultLocale: b.defaultLocale,
    colorPrimary,
    colorAccent,
    seoIndexable,
  };
}
