"use client";

import { useEffect, useState } from "react";
import { shouldGuardNavigation } from "./nav-guard";

/**
 * SCHUTZ VOR VERLORENEN ÄNDERUNGEN — die Mechanik, die der Artikel-Editor
 * seit dem Datenverlust-Fund vom 22.08.2026 hat, hier für alle Pflege-Flächen.
 *
 * ZWEI WEGE aus einer Seite, und sie brauchen ZWEI Mechanismen:
 *
 *  1. Echte Browser-Navigation (Reload, Tab schließen, fremde Adresse) →
 *     `beforeunload`. Achtung: Browser zeigen dort IHREN eigenen Dialog. Ein
 *     „Speichern"-Knopf ist darin technisch nicht möglich — sie erlauben nur
 *     bleiben oder verlassen. Mehr als eine Warnung ist hier nicht drin.
 *
 *  2. Navigation INNERHALB der App (Next-`<Link>`, router.push) → dort feuert
 *     `beforeunload` NIE. Deshalb fangen wir Anker-Klicks in der
 *     CAPTURE-Phase ab, bevor Next sie sieht. Nur hier können wir einen
 *     eigenen Dialog mit Speichern / Verwerfen / Abbrechen zeigen.
 *
 * Die Entscheidung, WELCHER Klick abgefangen wird, liegt in `nav-guard.ts`
 * (getestet): neue Tabs, Downloads, Anker-Sprünge, fremde Hosts und
 * Nicht-HTTP-Schemata bleiben unberührt — sonst wäre der Dialog nervig statt
 * hilfreich.
 */
export function useUnsavedGuard(dirty: boolean): {
  /** Ziel der abgefangenen Navigation; `null` = nichts steht an. */
  pendingHref: string | null;
  /** Abbrechen: Navigation verwerfen, auf der Seite bleiben. */
  cancel: () => void;
} {
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) {
      // Wird der Stand gespeichert, während der Dialog offen ist, gibt es
      // nichts mehr zu fragen.
      setPendingHref(null);
      return;
    }

    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);

    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      const guard = shouldGuardNavigation({
        dirty: true,
        href: anchor.getAttribute("href"),
        target: anchor.getAttribute("target"),
        modified: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0,
        download: anchor.hasAttribute("download"),
        origin: window.location.origin,
      });
      if (!guard) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(anchor.getAttribute("href"));
    };
    document.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  return { pendingHref, cancel: () => setPendingHref(null) };
}
