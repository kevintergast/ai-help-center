"use client";

import { useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import {
  ACTION_VARIANTS,
  ACTION_VARIANT_CLASSES,
  MAX_ACTION_LABEL,
  type ActionVariant,
} from "@/lib/content/action-buttons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SparkleIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";
import { useUnsavedGuard } from "@/lib/admin/use-unsaved-guard";
import { UnsavedGuardDialog } from "@/components/admin/unsaved-guard-dialog";

/**
 * ERSCHEINUNGSBILD DES WIDGETS (0041).
 *
 * Dieselben vier Varianten wie die Kopf-Knöpfe — ein Gestaltungsbegriff für
 * beide Flächen. Die Vorschau zeigt den Starter so, wie er auf der Kundenseite
 * steht; „Outlined" als Wort sagt weniger.
 *
 * SYMBOLE: PNG oder WebP, kein SVG. Nicht aus Bequemlichkeit — SVG kann
 * Skripte tragen und wäre same-origin ausgeliefert ein XSS-Vektor. Für ein
 * Symbol in fester Größe bringt Vektor ohnehin nichts, was doppelte Auflösung
 * nicht auch kann. Der Upload läuft über die Branding-Route, wo Typ-Prüfung,
 * Magic-Bytes-Abgleich und Größendeckel schon sitzen.
 */

const VARIANT_LABELS: Record<ActionVariant, MessageKey> = {
  ghost: "admin.headerActions.variant.ghost",
  outlined: "admin.headerActions.variant.outlined",
  filled: "admin.headerActions.variant.filled",
  colored: "admin.headerActions.variant.colored",
};

export function WidgetAppearanceManager({
  locale,
  initialVariant,
  initialLabel,
  initialIconUrl,
  initialIconOpenUrl,
}: {
  locale: Locale;
  initialVariant: ActionVariant;
  initialLabel: string | null;
  initialIconUrl: string | null;
  initialIconOpenUrl: string | null;
}) {
  const t = getT(locale);
  const [variant, setVariant] = useState<ActionVariant>(initialVariant);
  const [label, setLabel] = useState(initialLabel ?? "");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const dirty = variant !== initialVariant || label !== (initialLabel ?? "");
  const guard = useUnsavedGuard(dirty);

  async function save(): Promise<boolean> {
    setState("saving");
    try {
      const res = await fetch("/api/v1/admin/settings/widget-appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variant, label }),
      });
      if (!res.ok) throw new Error("save");
      setState("done");
      return true;
    } catch {
      setState("error");
      return false;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-muted">{t("admin.widget.appearanceHint")}</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52">
          <span className="mb-1 block text-xs text-ink-muted">
            {t("admin.headerActions.variant")}
          </span>
          <Select
            options={ACTION_VARIANTS.map((v) => ({ value: v, label: t(VARIANT_LABELS[v]) }))}
            value={variant}
            onValueChange={(v) => {
              setVariant(v as ActionVariant);
              setState("idle");
            }}
            aria-label={t("admin.headerActions.variant")}
          />
        </div>
        <Input
          label={t("admin.widget.label")}
          value={label}
          maxLength={MAX_ACTION_LABEL}
          onChange={(e) => {
            setLabel(e.target.value);
            setState("idle");
          }}
          placeholder={t("admin.widget.labelPlaceholder")}
          className="max-w-xs"
        />
      </div>

      {/* Vorschau des geschlossenen Starters. */}
      <div className="flex items-center gap-3 rounded-card border border-hairline bg-page p-4">
        <span className="text-xs text-ink-muted">{t("admin.headerActions.preview")}</span>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm shadow-[0_8px_24px_rgba(16,24,40,.18)]",
            ACTION_VARIANT_CLASSES[variant],
            label.length === 0 ? "h-12 w-12 justify-center p-0" : null,
          )}
        >
          {initialIconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={initialIconUrl} alt="" className="h-6 w-6 object-contain" />
          ) : (
            <SparkleIcon width={20} height={20} />
          )}
          {label.length > 0 ? label : null}
        </span>
      </div>

      <WidgetIconSlot
        locale={locale}
        variant="widget"
        title={t("admin.widget.iconClosed")}
        currentUrl={initialIconUrl}
      />
      <WidgetIconSlot
        locale={locale}
        variant="widget-open"
        title={t("admin.widget.iconOpen")}
        currentUrl={initialIconOpenUrl}
      />

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={state === "saving"}>
          {t("admin.widget.save")}
        </Button>
        <span aria-live="polite" className="text-xs">
          {state === "done" ? (
            <span className="text-ok">{t("admin.widget.saved")}</span>
          ) : state === "error" ? (
            <span className="text-crit">{t("admin.contact.error.generic")}</span>
          ) : null}
        </span>
      </div>

      <UnsavedGuardDialog
        locale={locale}
        href={guard.pendingHref}
        onCancel={guard.cancel}
        onSave={save}
        onDiscard={() => {
          setVariant(initialVariant);
          setLabel(initialLabel ?? "");
        }}
      />
    </div>
  );
}

/**
 * Ein Symbol-Slot. Lädt direkt gegen die Branding-Route hoch — dieselbe, die
 * Logo und Favicon benutzt, inklusive ihrer Prüfungen.
 */
function WidgetIconSlot({
  locale,
  variant,
  title,
  currentUrl,
}: {
  locale: Locale;
  variant: "widget" | "widget-open";
  title: string;
  currentUrl: string | null;
}) {
  const t = getT(locale);
  const [url, setUrl] = useState(currentUrl);
  const [state, setState] = useState<"idle" | "busy" | "error" | "rejected">("idle");

  async function upload(file: File) {
    setState("busy");
    try {
      const res = await fetch(`/api/v1/admin/branding/logo?variant=${variant}`, {
        method: "POST",
        headers: { "content-type": file.type },
        body: await file.arrayBuffer(),
      });
      if (res.status === 415 || res.status === 400) {
        setState("rejected");
        return;
      }
      if (!res.ok) throw new Error("upload");
      // Cache umgehen: Der R2-Schlüssel ist fest, die Adresse ändert sich nicht.
      setUrl(`/api/v1/branding/logo?variant=${variant}&v=${Date.now()}`);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-hairline bg-surface p-3">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-std border border-hairline bg-page">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-8 w-8 object-contain" />
        ) : (
          <SparkleIcon width={18} height={18} className="text-ink-muted" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{title}</p>
        <p className="text-xs text-ink-muted">{t("admin.widget.iconHint")}</p>
      </div>
      <label className="cursor-pointer rounded-std border border-hairline px-3 py-1.5 text-sm text-ink transition-colors hover:bg-tint">
        {state === "busy" ? t("admin.widget.uploading") : t("admin.widget.choose")}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      {state === "rejected" ? (
        <p className="w-full text-xs text-crit" role="alert">
          {t("admin.widget.iconRejected")}
        </p>
      ) : state === "error" ? (
        <p className="w-full text-xs text-crit" role="alert">
          {t("admin.contact.error.generic")}
        </p>
      ) : null}
    </div>
  );
}
