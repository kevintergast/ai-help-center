"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import {
  ACTION_VARIANTS,
  ACTION_VARIANT_CLASSES,
  MAX_ACTION_BUTTONS,
  parseActionButtonInput,
  type ActionButton,
  type ActionVariant,
} from "@/lib/content/action-buttons";
import { ARTICLE_ICONS, type ArticleIcon } from "@/lib/content/article-icons";
import { ArticleIconGlyph } from "@/components/ui/article-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { IconButton } from "@/components/ui/icon-button";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * AKTIONS-KNÖPFE im Kopf pflegen (0038).
 *
 * Jede Zeile zeigt eine LIVE-VORSCHAU des Knopfes — bei vier Varianten ist
 * „Outlined" als Wort weniger aussagekräftig als der Knopf selbst.
 *
 * Geprüft wird vor dem Senden mit derselben Funktion wie auf dem Server;
 * gespeichert wird der ganze Satz in EINEM Aufruf (die Knöpfe stehen im Kopf
 * JEDER Seite — ein Zwischenzustand wäre sofort überall sichtbar).
 */

type Draft = Omit<ActionButton, "id"> & { key: string };

const VARIANT_LABELS: Record<ActionVariant, MessageKey> = {
  ghost: "admin.headerActions.variant.ghost",
  outlined: "admin.headerActions.variant.outlined",
  filled: "admin.headerActions.variant.filled",
  colored: "admin.headerActions.variant.colored",
};

const ERROR_KEYS: Record<string, MessageKey> = {
  label_required: "admin.headerActions.error.label_required",
  label_too_long: "admin.headerActions.error.label_too_long",
  href_required: "admin.headerActions.error.href_required",
  invalid_href: "admin.headerActions.error.invalid_href",
  invalid_icon: "admin.headerActions.error.generic",
  invalid_variant: "admin.headerActions.error.generic",
};

let seq = 0;
const nextKey = () => `ha_draft_${(seq += 1)}`;

export function HeaderActionsManager({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [state, setState] = useState<"loading" | "idle" | "saving" | "done" | "error">("loading");
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/v1/admin/header-actions");
        if (!res.ok) throw new Error("load");
        const data = (await res.json()) as { buttons: ActionButton[] };
        if (!alive) return;
        setDrafts(data.buttons.map((b) => ({ ...b, key: nextKey() })));
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

  async function save() {
    const buttons: Omit<ActionButton, "id">[] = [];
    for (const d of drafts) {
      const res = parseActionButtonInput(d);
      if (!res.ok) {
        setErrorKey(ERROR_KEYS[res.error] ?? "admin.headerActions.error.generic");
        setState("idle");
        return;
      }
      buttons.push(res.button);
    }

    setState("saving");
    setErrorKey(null);
    try {
      const res = await fetch("/api/v1/admin/header-actions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ buttons }),
      });
      if (!res.ok) throw new Error("save");
      const fresh = (await res.json()) as { buttons: ActionButton[] };
      setDrafts(fresh.buttons.map((b) => ({ ...b, key: nextKey() })));
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "loading") return <p className="text-sm text-ink-muted">…</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-muted">
        {t("admin.headerActions.hint", { max: MAX_ACTION_BUTTONS })}
      </p>

      {drafts.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("admin.headerActions.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {drafts.map((d) => (
            <li
              key={d.key}
              className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-4"
            >
              {/* Umbruch erlaubt und Ausrichtung an der Unterkante: Die Zeile
                  hielt vorher mit fester Auswahlbreite + dehnbarem Feld + Knopf
                  auf schmalen Schirmen nicht mehr zusammen, und der Knopf saß
                  per festem Rand auf Position — sobald eine Beschriftung
                  umbrach, stand er daneben. */}
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  label={t("admin.headerActions.label")}
                  value={d.label}
                  onChange={(e) => patch(d.key, { label: e.target.value })}
                  placeholder={t("admin.headerActions.labelPlaceholder")}
                  className="min-w-[12rem] flex-1"
                />
                <div className="w-full min-w-[11rem] sm:w-44 sm:flex-none">
                  <span className="mb-1 block text-xs text-ink-muted">
                    {t("admin.headerActions.variant")}
                  </span>
                  <Select
                    options={ACTION_VARIANTS.map((v) => ({ value: v, label: t(VARIANT_LABELS[v]) }))}
                    value={d.variant}
                    onValueChange={(v) => patch(d.key, { variant: v as ActionVariant })}
                    aria-label={t("admin.headerActions.variant")}
                  />
                </div>
                <IconButton
                  aria-label={t("admin.headerActions.delete")}
                  onClick={() => {
                    setDrafts((ds) => ds.filter((x) => x.key !== d.key));
                    setState("idle");
                  }}
                  className="ml-auto"
                >
                  <CloseIcon width={16} height={16} />
                </IconButton>
              </div>

              <Input
                label={t("admin.headerActions.href")}
                value={d.href}
                onChange={(e) => patch(d.key, { href: e.target.value })}
                placeholder={t("admin.headerActions.hrefPlaceholder")}
              />

              <div>
                <span className="mb-2 block text-xs text-ink-muted">
                  {t("admin.headerActions.icon")}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <IconChoice
                    selected={d.icon === null}
                    label={t("admin.headerActions.iconNone")}
                    onSelect={() => patch(d.key, { icon: null })}
                  >
                    <CloseIcon width={15} height={15} />
                  </IconChoice>
                  {ARTICLE_ICONS.map((name) => (
                    <IconChoice
                      key={name}
                      selected={d.icon === name}
                      label={name}
                      onSelect={() => patch(d.key, { icon: name as ArticleIcon })}
                    >
                      <ArticleIconGlyph name={name} />
                    </IconChoice>
                  ))}
                </div>
              </div>

              {/* LIVE-VORSCHAU: „Outlined" als Wort sagt weniger als der Knopf. */}
              <div className="flex items-center gap-2 border-t border-hairline pt-3">
                <span className="text-xs text-ink-muted">{t("admin.headerActions.preview")}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-std px-2.5 py-1.5 text-sm",
                    ACTION_VARIANT_CLASSES[d.variant],
                  )}
                >
                  {d.icon ? <ArticleIconGlyph name={d.icon} size={15} /> : null}
                  {d.label || t("admin.headerActions.labelPlaceholder")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          onClick={() => {
            setDrafts((ds) => [
              ...ds,
              { key: nextKey(), label: "", icon: null, href: "", variant: "outlined" },
            ]);
            setState("idle");
          }}
          disabled={drafts.length >= MAX_ACTION_BUTTONS}
        >
          <PlusIcon width={16} height={16} />
          {t("admin.headerActions.add")}
        </Button>
        <Button onClick={() => void save()} disabled={state === "saving"}>
          {t("admin.headerActions.save")}
        </Button>
        <span aria-live="polite" className="text-xs">
          {errorKey ? (
            <span className="text-crit">{t(errorKey)}</span>
          ) : state === "done" ? (
            <span className="text-ok">{t("admin.headerActions.saved")}</span>
          ) : state === "error" ? (
            <span className="text-crit">{t("admin.headerActions.error.generic")}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function IconChoice({
  selected,
  label,
  onSelect,
  children,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-std border transition-colors",
        "focus-visible:outline-none focus-visible:shadow-focusglow",
        selected
          ? "border-brand bg-brand/10 text-ink"
          : "border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
