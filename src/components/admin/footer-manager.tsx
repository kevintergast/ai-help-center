"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import {
  DEFAULT_LEGAL_FOOTER,
  LEGAL_FOOTER_DOCS,
  MAX_FOOTER_LINKS,
  parseFooterLinkInput,
  type FooterLink,
  type LegalFooterDoc,
  type LegalFooterVisibility,
} from "@/lib/content/footer-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { IconButton } from "@/components/ui/icon-button";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { useUnsavedGuard } from "@/lib/admin/use-unsaved-guard";
import { UnsavedGuardDialog } from "@/components/admin/unsaved-guard-dialog";

/**
 * FUSS PFLEGEN (0046) — drei Rechtstext-Schalter, eigene Links, „Powered by".
 *
 * EIN Speichern-Knopf für alles: In der Oberfläche ist es eine Karte, und der
 * Fuß steht auf JEDER Seite der Instanz. Zwei getrennte Speicherwege hießen,
 * dass der zweite scheitern kann und der Fuß halb umgestellt draußen steht.
 *
 * Geprüft wird vor dem Senden mit derselben Funktion wie auf dem Server.
 */

const DOC_LABELS: Record<LegalFooterDoc, MessageKey> = {
  imprint: "hc.legal.imprint",
  privacy: "hc.legal.privacy",
  terms: "hc.legal.terms",
};

const ERROR_KEYS: Record<string, MessageKey> = {
  label_required: "admin.footer.error.label_required",
  label_too_long: "admin.footer.error.label_too_long",
  href_required: "admin.footer.error.href_required",
  invalid_href: "admin.footer.error.invalid_href",
};

type Draft = Omit<FooterLink, "id"> & { key: string };

let seq = 0;
const nextKey = () => `fl_draft_${(seq += 1)}`;

interface Snapshot {
  legal: LegalFooterVisibility;
  poweredBy: boolean;
  links: Omit<FooterLink, "id">[];
}

export function FooterManager({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [legal, setLegal] = useState<LegalFooterVisibility>(DEFAULT_LEGAL_FOOTER);
  const [poweredBy, setPoweredBy] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [state, setState] = useState<"loading" | "idle" | "saving" | "done" | "error">("loading");
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  /** Zuletzt GESPEICHERTER Stand — ohne ihn wüsste die Seite nicht, ob etwas offen ist. */
  const [pristine, setPristine] = useState<string>("");

  const current: Snapshot = {
    legal,
    poweredBy,
    links: drafts.map(({ key: _k, ...rest }) => rest),
  };
  const dirty = pristine !== "" && JSON.stringify(current) !== pristine;
  const guard = useUnsavedGuard(dirty);

  function apply(data: { legal: LegalFooterVisibility; poweredBy: boolean; links: FooterLink[] }) {
    setLegal(data.legal);
    setPoweredBy(data.poweredBy);
    const loaded = data.links.map((l) => ({ ...l, key: nextKey() }));
    setDrafts(loaded);
    setPristine(
      JSON.stringify({
        legal: data.legal,
        poweredBy: data.poweredBy,
        links: data.links.map(({ id: _i, ...rest }) => rest),
      }),
    );
  }

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/v1/admin/footer");
        if (!res.ok) throw new Error("load");
        const data = (await res.json()) as {
          legal: LegalFooterVisibility;
          poweredBy: boolean;
          links: FooterLink[];
        };
        if (!alive) return;
        apply(data);
        setState("idle");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function patch(key: string, change: Partial<Draft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...change } : d)));
    setState("idle");
    setErrorKey(null);
  }

  async function save(): Promise<boolean> {
    const links: Omit<FooterLink, "id">[] = [];
    for (const d of drafts) {
      const res = parseFooterLinkInput(d);
      if (!res.ok) {
        setErrorKey(ERROR_KEYS[res.error] ?? "admin.footer.error.generic");
        setState("idle");
        return false;
      }
      links.push(res.link);
    }

    setState("saving");
    setErrorKey(null);
    try {
      const res = await fetch("/api/v1/admin/footer", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legal, poweredBy, links }),
      });
      // Die Seite selbst steht schon `content`-Rollen offen; der Fuß ist eine
      // Instanz-Entscheidung und bleibt admin-exklusiv. Ohne diesen Zweig
      // sähe ein Redakteur nur „Speichern fehlgeschlagen".
      if (res.status === 403) {
        setErrorKey("admin.footer.adminOnly");
        setState("idle");
        return false;
      }
      if (!res.ok) throw new Error("save");
      apply(
        (await res.json()) as {
          legal: LegalFooterVisibility;
          poweredBy: boolean;
          links: FooterLink[];
        },
      );
      setState("done");
      return true;
    } catch {
      setState("error");
      return false;
    }
  }

  if (state === "loading") return <p className="text-sm text-ink-muted">…</p>;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-ink-muted">{t("admin.footer.hint")}</p>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t("admin.footer.legalHeading")}</h3>
        <p className="text-xs text-ink-muted">{t("admin.footer.legalHint")}</p>
        <div className="mt-1 flex flex-col gap-2">
          {LEGAL_FOOTER_DOCS.map((doc) => (
            <Switch
              key={doc}
              checked={legal[doc]}
              onCheckedChange={(v) => {
                setLegal((l) => ({ ...l, [doc]: v }));
                setState("idle");
              }}
              label={t(DOC_LABELS[doc])}
            />
          ))}
        </div>
        {/* Kein Verbot, nur ein ehrlicher Hinweis: Die Entscheidung trifft der
            Betreiber — er kennt seinen Fall. Aber er soll sie bewusst treffen. */}
        {!legal.privacy ? (
          <p className="mt-1 text-xs text-warn">{t("admin.footer.privacyWarning")}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-hairline pt-5">
        <h3 className="text-sm font-medium">{t("admin.footer.linksHeading")}</h3>
        <p className="text-xs text-ink-muted">
          {t("admin.footer.linksHint", { max: MAX_FOOTER_LINKS })}
        </p>

        {drafts.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">{t("admin.footer.empty")}</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-3">
            {drafts.map((d) => (
              <li key={d.key} className="flex flex-wrap items-end gap-3">
                <Input
                  label={t("admin.footer.label")}
                  value={d.label}
                  onChange={(e) => patch(d.key, { label: e.target.value })}
                  placeholder={t("admin.footer.labelPlaceholder")}
                  className="min-w-[10rem] flex-1"
                />
                <Input
                  label={t("admin.footer.href")}
                  value={d.href}
                  onChange={(e) => patch(d.key, { href: e.target.value })}
                  placeholder={t("admin.footer.hrefPlaceholder")}
                  className="min-w-[14rem] flex-[2]"
                />
                <IconButton
                  aria-label={t("admin.footer.delete")}
                  onClick={() => {
                    setDrafts((ds) => ds.filter((x) => x.key !== d.key));
                    setState("idle");
                  }}
                >
                  <CloseIcon width={16} height={16} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-1">
          <Button
            variant="ghost"
            onClick={() => {
              setDrafts((ds) => [...ds, { key: nextKey(), label: "", href: "" }]);
              setState("idle");
            }}
            disabled={drafts.length >= MAX_FOOTER_LINKS}
          >
            <PlusIcon width={16} height={16} />
            {t("admin.footer.add")}
          </Button>
        </div>
      </div>

      <div className="border-t border-hairline pt-5">
        <Switch
          checked={poweredBy}
          onCheckedChange={(v) => {
            setPoweredBy(v);
            setState("idle");
          }}
          label={t("admin.footer.poweredBy")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={state === "saving"}>
          {t("admin.footer.save")}
        </Button>
        <span aria-live="polite" className="text-xs">
          {errorKey ? (
            <span className="text-crit">{t(errorKey)}</span>
          ) : state === "done" ? (
            <span className="text-ok">{t("admin.footer.saved")}</span>
          ) : state === "error" ? (
            <span className="text-crit">{t("admin.footer.error.generic")}</span>
          ) : null}
        </span>
      </div>

      <UnsavedGuardDialog
        locale={locale}
        href={guard.pendingHref}
        onCancel={guard.cancel}
        onSave={save}
        onDiscard={() => {
          const snap = JSON.parse(pristine) as Snapshot;
          setLegal(snap.legal);
          setPoweredBy(snap.poweredBy);
          setDrafts(snap.links.map((l) => ({ ...l, key: nextKey() })));
        }}
      />
    </div>
  );
}
