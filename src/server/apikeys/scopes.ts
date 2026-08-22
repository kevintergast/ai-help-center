/**
 * SCOPE-KATALOG — die EINZIGE Quelle dafür, was ein API-Key darf.
 *
 * Von hier lesen: die Key-Erstellung (Validierung + Warnstufen), die Admin-UI
 * (Gruppierung, Risiko-Badge) und der MCP-Server (welche Tools ein Schlüssel
 * überhaupt sieht). Ein neuer Scope wird an GENAU dieser Stelle geboren.
 *
 * STUFEN (docs/mcp-plan.md §5/§6) — die Reihenfolge ist die Eskalation:
 *   read        grün    Lesen. Nichts verändert sich.
 *   write       gelb    Schreibt Entwürfe. Bleibt intern, niemand sieht es.
 *   public      orange  Wirkt nach außen — Endkunden sehen es sofort.
 *   destructive rot     Löscht. Braucht zusätzlich eine Bestätigung (§7).
 *
 * `summary` ist bewusst ENGLISCH und maschinen-nah: dieser Text geht an das
 * LLM des Kunden (MCP-Tool `get_permissions`), NICHT ins UI. Die deutschen/
 * englischen UI-Texte liegen in `src/i18n/messages/*` (Regel: kein Literal in
 * .tsx) und werden über die Scope-Id gemappt.
 */

export const SCOPE_TIERS = ["read", "write", "public", "destructive"] as const;
export type ScopeTier = (typeof SCOPE_TIERS)[number];

export interface ScopeDef {
  tier: ScopeTier;
  /** Klartext-Konsequenz für den MCP-Client (englisch, maschinen-nah). */
  summary: string;
  /**
   * true = die Tools hinter diesem Scope liefern personenbezogene Daten von
   * ENDKUNDEN an den KI-Anbieter des Kunden aus. Die UI warnt dafür eigens
   * (DSGVO: das ist eine bewusste Entscheidung des Verantwortlichen).
   */
  pii?: true;
}

export const API_SCOPES = {
  "articles:read": {
    tier: "read",
    summary: "Read help articles, drafts, categories, translations and conventions.",
  },
  "analytics:read": {
    tier: "read",
    summary: "Read aggregated usage statistics, top articles, helpfulness and plan usage.",
  },
  "settings:read": {
    tier: "read",
    summary: "Read branding and help center settings.",
  },
  "articles:write": {
    tier: "write",
    summary:
      "Create and edit articles, images, videos and translations. Everything stays a draft — this scope cannot publish.",
  },
  "articles:publish": {
    tier: "public",
    summary: "Publish and unpublish articles. Published changes are immediately visible to end users.",
  },
  "settings:write": {
    tier: "public",
    summary: "Change branding, SEO indexing, support address and default language. Visible to end users.",
  },
  "support:read": {
    tier: "public",
    summary:
      "Read support tickets. WARNING: tickets contain personal data of end users (email addresses, free text).",
    pii: true,
  },
  "support:write": {
    tier: "public",
    summary: "Update support ticket status.",
  },
  "articles:delete": {
    tier: "destructive",
    summary:
      "Permanently delete articles and images. Requires an explicit confirmation step for every deletion.",
  },
  "support:delete": {
    tier: "destructive",
    summary: "Permanently delete support tickets. Requires an explicit confirmation step.",
  },
} as const satisfies Record<string, ScopeDef>;

export type ApiScope = keyof typeof API_SCOPES;

export const ALL_SCOPES = Object.keys(API_SCOPES) as ApiScope[];

/**
 * Voreinstellung der Key-Erstellung: bewusst zahm. Lesen + Entwürfe schreiben —
 * alles, was nach außen wirkt oder löscht, muss der Nutzer aktiv einschalten.
 */
export const DEFAULT_SCOPES: readonly ApiScope[] = ["articles:read", "articles:write"];

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && value in API_SCOPES;
}

/**
 * Katalog-Eintrag als ScopeDef. `as const satisfies` macht die Einträge
 * literal — optionale Felder (`pii`) sind dann nur über den Vertragstyp
 * erreichbar. Diese eine Stelle kapselt das, statt es überall zu casten.
 */
export function scopeDef(scope: ApiScope): ScopeDef {
  return API_SCOPES[scope];
}

export function tierOf(scope: ApiScope): ScopeTier {
  return API_SCOPES[scope].tier;
}

/**
 * Scope-Liste aus unbekannter Eingabe (Request-Body oder DB-Spalte).
 * `null` = ungültig (unbekannter Scope, kein Array, leer) — fail-closed, es
 * gibt bewusst kein „unbekannte Scopes still verwerfen".
 */
export function parseScopes(raw: unknown): ApiScope[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ApiScope[] = [];
  for (const entry of raw) {
    if (!isApiScope(entry)) return null;
    if (!out.includes(entry)) out.push(entry);
  }
  // Stabile Reihenfolge (Katalog-Reihenfolge = Eskalations-Reihenfolge).
  return ALL_SCOPES.filter((s) => out.includes(s));
}

/**
 * Gespeicherte Scopes lesen. Anders als `parseScopes` TOLERANT gegen
 * unbekannte Einträge: ein Scope, den es im Code nicht mehr gibt, darf einen
 * Schlüssel nicht unbrauchbar machen — er wird schlicht ignoriert (und damit
 * auch nicht mehr gewährt). Ein Schlüssel ohne verbleibende Scopes kann nichts.
 */
export function readStoredScopes(json: string): ApiScope[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return ALL_SCOPES.filter((s) => parsed.includes(s));
}

/** Trägt der Schlüssel den geforderten Scope? */
export function hasScope(granted: readonly ApiScope[], needed: ApiScope): boolean {
  return granted.includes(needed);
}

/** Scopes, die der Nutzer beim Anlegen EINZELN bestätigen muss (rote Stufe). */
export function scopesNeedingAcknowledgement(scopes: readonly ApiScope[]): ApiScope[] {
  return scopes.filter((s) => tierOf(s) === "destructive");
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

const TIER_RISK: Record<ScopeTier, RiskLevel> = {
  read: "low",
  write: "medium",
  public: "high",
  destructive: "critical",
};

/** Höchste enthaltene Stufe bestimmt das Risiko-Badge der Auswahl. */
export function riskLevel(scopes: readonly ApiScope[]): RiskLevel {
  let level: RiskLevel = "low";
  const order: RiskLevel[] = ["low", "medium", "high", "critical"];
  for (const scope of scopes) {
    const candidate = TIER_RISK[tierOf(scope)];
    if (order.indexOf(candidate) > order.indexOf(level)) level = candidate;
  }
  return level;
}

/**
 * „Dieser Schlüssel kann praktisch alles" — veröffentlichen UND löschen UND
 * Einstellungen ändern. Die UI empfiehlt dann, ihn aufzuteilen (ein Lese-Key
 * für Recherche, ein enger Schreib-Key), statt einen Generalschlüssel zu bauen.
 */
export function isBroadAccess(scopes: readonly ApiScope[]): boolean {
  return (
    scopes.includes("articles:publish") &&
    scopes.includes("articles:delete") &&
    scopes.includes("settings:write")
  );
}

/** Enthält die Auswahl Scopes, über die personenbezogene Daten abfließen? */
export function includesPii(scopes: readonly ApiScope[]): boolean {
  return scopes.some((s) => scopeDef(s).pii === true);
}
