"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Button } from "@/components/ui/button";

/**
 * ZIELE DER OPERATOR-INSTANZ auf das Hilfezentrum DES LESERS umlenken.
 *
 * Unsere eigenen Artikel beschreiben Handgriffe im Verwaltungsbereich und
 * hinterlegen dafür Ziele wie `/admin/team`. Auf app.hallofhelp.com zeigen
 * die aber auf UNSEREN Verwaltungsbereich — der Leser landete im Nichts.
 * Gemeint ist immer seine eigene Instanz.
 *
 * NUR hier: Kundeninstanzen verweisen auf ihre festen Domains, dort gibt es
 * nichts umzulenken. Deshalb hängt die ganze Komponente an `isOperator`.
 *
 * AUFLÖSUNG BEIM KLICK, nicht beim Rendern. Das deckt alle drei
 * Erscheinungsformen eines Ziels mit EINEM Listener ab — Knopf in der
 * KI-Antwort, Link mitten im Satz und Symbol an der Überschrift —, es
 * funktioniert auch in servergerendertem HTML, und solange niemand klickt,
 * steht nirgends ein falscher Link.
 */

interface HelpCenter {
  tenantId: string;
  name: string;
  slug: string;
  helpCenterUrl: string;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  /** Nicht angemeldet — der Weg führt über Anmeldung oder Registrierung. */
  | { kind: "anonymous" }
  /** Angemeldet, aber noch kein Hilfezentrum angelegt. */
  | { kind: "empty" }
  /** Mehrere, noch keine Wahl getroffen. */
  | { kind: "choose"; list: HelpCenter[] };

export function DestinationResolver({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [state, setState] = useState<State>({ kind: "idle" });
  /** Position des angeklickten Links — der Hinweis erscheint daneben. */
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  /** Pfad, der nach einer Wahl geöffnet werden soll. */
  const pending = useRef<string | null>(null);
  /** Einmal geladen, dann im Speicher — ein Klick soll nicht warten müssen. */
  const cache = useRef<{ list: HelpCenter[]; defaultTenantId: string | null } | null>(null);

  const load = useCallback(async () => {
    if (cache.current) return cache.current;
    const res = await fetch("/api/v1/operator/help-centers");
    if (res.status === 401) return null; // nicht angemeldet
    if (!res.ok) return null;
    const data = (await res.json()) as {
      defaultTenantId: string | null;
      helpCenters: HelpCenter[];
    };
    cache.current = { list: data.helpCenters, defaultTenantId: data.defaultTenantId };
    return cache.current;
  }, []);

  /** Pfad am gewählten Hilfezentrum öffnen. */
  const open = useCallback((base: string, path: string) => {
    window.open(base.replace(/\/$/, "") + path, "_blank", "noopener,noreferrer");
  }, []);

  const choose = useCallback(
    async (hc: HelpCenter) => {
      // Wahl ans Konto — sie soll auch auf dem nächsten Gerät gelten.
      try {
        await fetch("/api/v1/operator/help-centers/default", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tenantId: hc.tenantId }),
        });
      } catch {
        /* Die Wahl ist auch ohne Speichern für DIESEN Klick gültig. */
      }
      if (cache.current) cache.current.defaultTenantId = hc.tenantId;
      window.dispatchEvent(new Event(HELP_CENTER_CHANGED));
      const path = pending.current;
      pending.current = null;
      setState({ kind: "idle" });
      if (path) open(hc.helpCenterUrl, path);
    },
    [open],
  );

  useEffect(() => {
    async function onClick(ev: MouseEvent) {
      const el = (ev.target as HTMLElement | null)?.closest?.("a[data-destination]");
      if (!(el instanceof HTMLAnchorElement)) return;
      const path = el.getAttribute("data-destination") ?? "";
      // Vollständige Adressen gehören niemandem von uns — unangetastet lassen.
      if (!path.startsWith("/") || path.startsWith("//")) return;

      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      setAnchor({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 340) });
      setState({ kind: "loading" });

      const data = await load();
      if (!data) {
        pending.current = path;
        setState({ kind: "anonymous" });
        return;
      }
      if (data.list.length === 0) {
        pending.current = path;
        setState({ kind: "empty" });
        return;
      }
      const chosen = data.list.find((h) => h.tenantId === data.defaultTenantId);
      if (chosen) {
        setState({ kind: "idle" });
        open(chosen.helpCenterUrl, path);
        return;
      }
      pending.current = path;
      setState({ kind: "choose", list: data.list });
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [load, open]);

  if (state.kind === "idle" || !anchor) return null;

  return (
    <>
      {/* Klick daneben schließt — ein Hinweis, der sich nicht wegklicken
          lässt, ist eine Falle. */}
      <div
        className="fixed inset-0 z-40"
        onClick={() => setState({ kind: "idle" })}
        aria-hidden
      />
      <div
        role="dialog"
        style={{ top: anchor.top, left: anchor.left }}
        className="fixed z-50 w-[320px] rounded-card border border-hairline bg-surface p-4 shadow-lg"
      >
        {state.kind === "loading" ? (
          <p className="text-sm text-ink-muted">{t("hc.destination.loading")}</p>
        ) : state.kind === "anonymous" ? (
          <>
            <p className="mb-3 text-sm text-ink">{t("hc.destination.signInBody")}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => (window.location.href = "/login")}>
                {t("hc.destination.signIn")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => (window.location.href = "/signup")}
              >
                {t("hc.destination.createAccount")}
              </Button>
            </div>
          </>
        ) : state.kind === "empty" ? (
          <>
            <p className="mb-3 text-sm text-ink">{t("hc.destination.noHelpCenterBody")}</p>
            <Button size="sm" onClick={() => (window.location.href = "/console")}>
              {t("hc.destination.createHelpCenter")}
            </Button>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink">{t("hc.destination.chooseBody")}</p>
            <ul className="flex flex-col gap-1">
              {state.list.map((hc) => (
                <li key={hc.tenantId}>
                  <button
                    type="button"
                    onClick={() => void choose(hc)}
                    className="w-full rounded-std px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-tint"
                  >
                    {hc.name}
                    <span className="block text-xs text-ink-muted">{hc.slug}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-muted">{t("hc.destination.chooseHint")}</p>
          </>
        )}
      </div>
    </>
  );
}

/** Feuert, wenn der Leser sein Hilfezentrum gewechselt hat (Kopf-Umschalter). */
export const HELP_CENTER_CHANGED = "hh-help-center-changed";
