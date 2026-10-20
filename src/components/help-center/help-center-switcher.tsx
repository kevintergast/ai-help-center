"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { ChevronDownIcon } from "@/components/ui/icons";
import { HELP_CENTER_CHANGED } from "./destination-resolver";

/**
 * UMSCHALTER im Kopf — nur für Leser der Operator-Instanz, die MEHRERE
 * Hilfezentren haben.
 *
 * Er beantwortet eine Frage, die sonst unsichtbar bliebe: „Auf welche meiner
 * Instanzen zeigen die Links in diesen Artikeln gerade?" Ohne ihn müsste ein
 * Nutzer mit zwei Hilfezentren raten, wohin der nächste Klick führt.
 *
 * Bei genau EINEM Hilfezentrum erscheint er nicht: Dort gibt es nichts zu
 * wechseln, und ein Menü mit einem Eintrag ist nur Lärm.
 */

interface HelpCenter {
  tenantId: string;
  name: string;
  slug: string;
  helpCenterUrl: string;
}

export function HelpCenterSwitcher({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [list, setList] = useState<HelpCenter[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/operator/help-centers");
      if (!res.ok) return; // anonym (401) → kein Umschalter
      const data = (await res.json()) as {
        defaultTenantId: string | null;
        helpCenters: HelpCenter[];
      };
      setList(data.helpCenters);
      setCurrent(data.defaultTenantId);
    } catch {
      /* Ohne Liste kein Umschalter — das ist der richtige Rückfall. */
    }
  }, []);

  useEffect(() => {
    void load();
    // Der Auflöser meldet, wenn im Hinweis-Feld gewählt wurde.
    const onChanged = () => void load();
    window.addEventListener(HELP_CENTER_CHANGED, onChanged);
    return () => window.removeEventListener(HELP_CENTER_CHANGED, onChanged);
  }, [load]);

  async function pick(hc: HelpCenter) {
    setCurrent(hc.tenantId);
    setOpen(false);
    try {
      await fetch("/api/v1/operator/help-centers/default", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: hc.tenantId }),
      });
    } catch {
      /* ignore — die Anzeige stimmt, beim nächsten Laden zählt der Server */
    }
  }

  // Erst ab zwei Hilfezentren, und erst wenn eines gewählt ist: Vorher ist
  // der Umschalter eine Antwort auf eine Frage, die noch niemand gestellt hat.
  if (list.length < 2 || !current) return null;
  const active = list.find((h) => h.tenantId === current);
  if (!active) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("hc.switcher.title")}
        className="inline-flex max-w-[180px] items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        <span className="truncate">{active.name}</span>
        <ChevronDownIcon width={14} height={14} className="shrink-0" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <ul
            role="listbox"
            className="absolute right-0 z-50 mt-1 w-56 rounded-card border border-hairline bg-surface p-1 shadow-lg"
          >
            {list.map((hc) => (
              <li key={hc.tenantId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={hc.tenantId === current}
                  onClick={() => void pick(hc)}
                  className={`w-full rounded-std px-2 py-1.5 text-left text-sm transition-colors hover:bg-tint ${
                    hc.tenantId === current ? "text-brand" : "text-ink"
                  }`}
                >
                  {hc.name}
                  <span className="block text-xs text-ink-muted">{hc.slug}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
