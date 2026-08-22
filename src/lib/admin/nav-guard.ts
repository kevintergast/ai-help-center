/**
 * NAVIGATIONS-SCHUTZ für den Editor (Datenverlust-Fund 2026-08-22: ein Klick
 * auf eine Artikel-Link-Card im Bearbeiten-Modus navigierte weg und der
 * gesamte ungespeicherte Entwurf war verloren).
 *
 * WARUM EIN EIGENER GUARD: `beforeunload` greift NUR bei echten Browser-
 * Navigationen (Reload, Tab schließen, fremde Origin). Next.js `<Link>`/
 * `router.push` navigieren CLIENT-seitig — dort feuert `beforeunload` nie.
 * Der App Router hat (Stand Next 15) kein offizielles Blockier-API, deshalb
 * fangen wir Klicks auf Anker in der Capture-Phase ab und fragen nach.
 *
 * Diese Datei enthält nur die REINE Entscheidung (testbar); das Abfangen
 * selbst hängt im Editor (article-editor.tsx).
 */

export interface GuardDecisionInput {
  /** Ungespeicherte Änderungen vorhanden? */
  dirty: boolean;
  /** `href`-Attribut des angeklickten Ankers (roh, wie im DOM). */
  href: string | null;
  /** `target`-Attribut (z. B. `_blank` öffnet einen neuen Tab → egal). */
  target?: string | null;
  /** Modifier-Tasten/mittlere Maustaste öffnen ebenfalls neue Tabs. */
  modified?: boolean;
  /** Download-Links verlassen die Seite nicht. */
  download?: boolean;
  /** Aktueller Origin (für die Fremd-/Eigen-Unterscheidung). */
  origin: string;
}

/**
 * Soll dieser Anker-Klick abgefangen und rückgefragt werden?
 *
 * NUR für Ziele, die den Editor wirklich verlassen und dabei den Entwurf
 * verlieren würden: same-origin-Navigationen bei ungespeichertem Stand.
 * Neue Tabs (target/Modifier), Downloads, Anker-Sprünge (#), Nicht-HTTP-
 * Schemata (mailto:, tel:) und fremde Hosts (dort greift `beforeunload`)
 * bleiben unberührt — sonst würde der Dialog nervig statt hilfreich.
 */
export function shouldGuardNavigation(input: GuardDecisionInput): boolean {
  if (!input.dirty) return false;
  if (!input.href) return false;
  if (input.download) return false;
  if (input.modified) return false;
  if (input.target && input.target !== "" && input.target !== "_self") return false;
  if (input.href.startsWith("#")) return false;

  let url: URL;
  try {
    url = new URL(input.href, input.origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.origin !== input.origin) return false;
  // Reiner Hash-Wechsel auf derselben Seite = keine Navigation.
  const here = new URL(input.origin);
  return !(url.pathname === here.pathname && url.search === here.search && url.hash !== "");
}
