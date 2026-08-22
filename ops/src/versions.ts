/**
 * DEPLOYTE VERSIONEN (Versionierung, docs/versioning.md).
 *
 * Das Ops-Dashboard fragt die Health-Endpunkte der Umgebungen ab, damit
 * „welche Version läuft in Produktion?" ohne CI-Logs oder Cloudflare-Dashboard
 * beantwortet ist. Ground Truth ist das Deployment selbst.
 *
 * Fehlertoleranz ist Teil der Aufgabe: ist eine Umgebung nicht erreichbar,
 * zeigt das Dashboard genau das an — niemals eine geratene Version.
 */

export interface HealthApp {
  version?: string;
  commit?: string;
  builtAt?: string | null;
  env?: string;
}

export interface Deployment {
  label: string;
  url: string;
  app?: HealthApp;
  error?: string;
}

export const DEPLOY_TARGETS = [
  { label: "Produktion", url: "https://app.hallofhelp.com" },
  { label: "Staging", url: "https://app.dev.hallofhelp.com" },
] as const;

const TIMEOUT_MS = 4000;

/** Health einer Umgebung holen; Fehler werden zu `error`, nie zu einem Wurf. */
export async function fetchDeployment(target: { label: string; url: string }): Promise<Deployment> {
  try {
    const res = await fetch(`${target.url}/api/v1/health`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
      // Immer frisch: eine gecachte Versionsauskunft ist wertlos.
      cf: { cacheTtl: 0 },
    } as RequestInit);
    if (!res.ok) return { ...target, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { app?: HealthApp };
    if (!body.app) return { ...target, error: "Antwort ohne Versionsinfo" };
    return { ...target, app: body.app };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    return { ...target, error: name === "TimeoutError" ? "Zeitüberschreitung" : "nicht erreichbar" };
  }
}

export function fetchDeployments(
  targets: readonly { label: string; url: string }[] = DEPLOY_TARGETS,
): Promise<Deployment[]> {
  return Promise.all(targets.map(fetchDeployment));
}

/**
 * SemVer-Vergleich: -1 = a älter, 0 = gleich, 1 = a neuer.
 * Unlesbare Werte (z. B. "unknown") gelten als älter als jede echte Version,
 * damit ein kaputtes Deployment nie als „aktuell" durchgeht.
 */
export function compareVersions(a: string | undefined, b: string | undefined): number {
  const parse = (v: string | undefined): [number, number, number] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? "").trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/**
 * Hinweis für die Anzeige: liegt Staging VOR Produktion, wartet ein Release
 * auf den Merge nach main. Gleichstand oder fehlende Daten → kein Hinweis
 * (nichts erfinden).
 */
export function releasePending(deployments: Deployment[]): boolean {
  const prod = deployments.find((d) => d.label === "Produktion")?.app?.version;
  const staging = deployments.find((d) => d.label === "Staging")?.app?.version;
  if (!prod || !staging) return false;
  return compareVersions(staging, prod) > 0;
}

/** „vor 3 Std." — kompakte Altersangabe der Build-Zeit; null bei Unsinn. */
export function buildAge(builtAt: string | null | undefined, now: number): string | null {
  if (!builtAt) return null;
  const ts = Date.parse(builtAt);
  if (Number.isNaN(ts)) return null;
  const minutes = Math.max(0, Math.round((now - ts) / 60000));
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `vor ${hours} Std.`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}
