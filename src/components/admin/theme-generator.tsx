"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale, TenantBranding } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import { isHexColor, normalizeHex } from "@/lib/theme/color";
import { auditPalette } from "@/lib/theme/contrast";
import { paletteToStyle } from "@/lib/theme/css";
import {
  DEFAULT_ANCHORS,
  NEUTRAL_TONES,
  SURFACE_STYLES,
  generateTheme,
  type NeutralTone,
  type SurfaceStyle,
  type ThemeAnchors,
} from "@/lib/theme/generate";
import type { ThemeConfig } from "@/lib/theme/palette";
import {
  DARK_DEFAULTS,
  LIGHT_DEFAULTS,
  THEME_TOKEN_GROUPS,
  tokensOfGroup,
  type ThemeMode,
  type ThemePalette,
  type ThemeTokenGroup,
  type ThemeTokenKey,
} from "@/lib/theme/tokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckIcon, WarnIcon } from "@/components/ui/icons";
import { useUnsavedGuard } from "@/lib/admin/use-unsaved-guard";
import { UnsavedGuardDialog } from "@/components/admin/unsaved-guard-dialog";

/**
 * THEME-GENERATOR (0045).
 *
 * Zwei Schritte, bewusst in dieser Reihenfolge: Erst erzeugt der Generator aus
 * vier Angaben eine vollständige, geprüfte Farbwelt für BEIDE Modi. Danach
 * lässt sich jeder Token einzeln überschreiben — je Modus getrennt, weil
 * Marken mit eigenem Dunkel-Schema sonst nicht unterzubringen wären.
 *
 * Die Kontrollspalte rechts ist nicht Zierde: Wer 48 Werte frei setzen darf,
 * macht sich unlesbar, und zwar ohne es zu merken, weil man die eigene Marke
 * schöner findet als lesbar. Beanstandungen werden ANGEZEIGT, nicht
 * verhindert — es gibt legitime Sonderfälle, und eine Sperre würde nur
 * Umgehungen provozieren.
 */

const TOKEN_LABELS: Record<ThemeTokenKey, MessageKey> = {
  page: "admin.theme.token.page",
  surface: "admin.theme.token.surface",
  "surface-2": "admin.theme.token.surface2",
  tint: "admin.theme.token.tint",
  ink: "admin.theme.token.ink",
  muted: "admin.theme.token.muted",
  border: "admin.theme.token.border",
  "border-strong": "admin.theme.token.borderStrong",
  "brand-primary": "admin.theme.token.brandPrimary",
  "brand-accent": "admin.theme.token.brandAccent",
  "brand-primary-fg": "admin.theme.token.brandPrimaryFg",
  "btn-primary-bg": "admin.theme.token.btnPrimaryBg",
  "btn-primary-fg": "admin.theme.token.btnPrimaryFg",
  "sem-info": "admin.theme.token.semInfo",
  "sem-info-bg": "admin.theme.token.semInfoBg",
  "sem-ok": "admin.theme.token.semOk",
  "sem-ok-bg": "admin.theme.token.semOkBg",
  "sem-ok-bd": "admin.theme.token.semOkBd",
  "sem-warn": "admin.theme.token.semWarn",
  "sem-warn-bg": "admin.theme.token.semWarnBg",
  "sem-warn-bd": "admin.theme.token.semWarnBd",
  "sem-crit": "admin.theme.token.semCrit",
  "sem-crit-bg": "admin.theme.token.semCritBg",
  "sem-crit-bd": "admin.theme.token.semCritBd",
};

const GROUP_LABELS: Record<ThemeTokenGroup, MessageKey> = {
  surfaces: "admin.theme.group.surfaces",
  text: "admin.theme.group.text",
  lines: "admin.theme.group.lines",
  brand: "admin.theme.group.brand",
  button: "admin.theme.group.button",
  semantic: "admin.theme.group.semantic",
};

const NEUTRAL_LABELS: Record<NeutralTone, MessageKey> = {
  cool: "admin.theme.neutral.cool",
  neutral: "admin.theme.neutral.neutral",
  warm: "admin.theme.neutral.warm",
};

const SURFACE_LABELS: Record<SurfaceStyle, MessageKey> = {
  plain: "admin.theme.surface.plain",
  tinted: "admin.theme.surface.tinted",
};

/**
 * Der Zustand, den die Seite OHNE eigene Farbwelt zeigt: das Standard-Theme,
 * überschrieben von den drei Marken-Farben — also genau das, was Besucher
 * heute sehen. Die Feinjustierung startet damit nicht bei einer Fiktion.
 */
function fromBranding(b: TenantBranding): ThemeConfig {
  const brand = {
    "brand-primary": normalizeHex(b.colorPrimary) ?? LIGHT_DEFAULTS["brand-primary"],
    "brand-accent": normalizeHex(b.colorAccent) ?? LIGHT_DEFAULTS["brand-accent"],
    "brand-primary-fg": normalizeHex(b.colorPrimaryFg) ?? LIGHT_DEFAULTS["brand-primary-fg"],
  };
  return {
    anchors: { ...DEFAULT_ANCHORS, brand: brand["brand-primary"], accent: brand["brand-accent"] },
    light: { ...LIGHT_DEFAULTS, ...brand },
    dark: { ...DARK_DEFAULTS, ...brand },
  };
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
      <span className="text-sm text-ink-muted">{label}</span>
      <div className="flex flex-wrap gap-1 rounded-std border border-hairline bg-surface-raised p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={
              "flex-1 rounded-[6px] px-3 py-1.5 text-sm transition-colors " +
              (value === o.value ? "bg-brand text-brand-fg" : "text-ink hover:bg-tint")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Farbwähler + Textfeld für EINEN Hex-Wert.
 *
 * Der Textentwurf MUSS lokal leben. Ohne ihn ist das Feld nicht bedienbar:
 * Beim Tippen von "#b91c1c" ist jeder Zwischenstand ("#", "#b", "#b9", …)
 * ungültig, der Zustand oben ändert sich also nie — und React setzt das
 * kontrollierte Feld bei jedem Tastendruck auf den alten Wert zurück. Genau
 * das hatten die Anker-Felder anfangs, und es fiel erst im Browser auf.
 *
 * Übernommen wird nur, was `isHexColor` besteht; beim Verlassen springt ein
 * unfertiger Entwurf auf den gültigen Wert zurück, damit nichts sichtbar
 * stehen bleibt, was nirgends gespeichert ist.
 */
function HexInput({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <>
      <input
        type="color"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-12 shrink-0 cursor-pointer rounded-std border border-hairline bg-surface p-1"
      />
      <Input
        value={draft}
        spellCheck={false}
        aria-label={label}
        onChange={(e) => {
          setDraft(e.target.value);
          const hex = normalizeHex(e.target.value);
          if (hex) onChange(hex);
        }}
        onBlur={() => {
          if (!isHexColor(draft)) setDraft(value);
        }}
        className="w-28 shrink-0 font-mono"
      />
    </>
  );
}

/** Eine Zeile der Feinjustierung: Beschriftung, Variablenname, Hex-Eingabe. */
function ColorField({
  label,
  token,
  value,
  warned,
  warnLabel,
  onChange,
}: {
  label: string;
  token: ThemeTokenKey;
  value: string;
  warned: boolean;
  warnLabel: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex min-w-[11rem] flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-sm">
          {label}
          {warned ? (
            <WarnIcon width={14} height={14} className="text-warn" aria-label={warnLabel} />
          ) : null}
        </span>
        <code className="font-mono text-[11px] text-ink-muted">--{token}</code>
      </span>
      <HexInput value={value} label={label} onChange={onChange} />
    </div>
  );
}

/** Kleine Nachbildung des Hilfezentrums — genug Tokens auf einmal, um zu
 *  sehen, was eine Änderung anrichtet. */
function Preview({ palette, locale }: { palette: ThemePalette; locale: Locale }) {
  const t = getT(locale);
  return (
    <div
      style={paletteToStyle(palette)}
      className="overflow-hidden rounded-card border border-hairline"
    >
      <div className="flex flex-col gap-3 bg-page p-4">
        <div className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-4">
          <h4 className="font-semibold tracking-[-0.3px] text-ink">
            {t("admin.theme.preview.heading")}
          </h4>
          <p className="text-sm text-ink-muted">{t("admin.theme.preview.body")}</p>
          <div className="rounded-std border border-hairline-strong bg-surface-raised px-3 py-2 text-sm text-ink-muted">
            {t("admin.theme.preview.field")}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-std bg-brand px-3 py-1.5 text-sm text-brand-fg">
              {t("admin.theme.preview.primary")}
            </span>
            <span className="rounded-std border border-hairline-strong px-3 py-1.5 text-sm text-ink">
              {t("admin.theme.preview.secondary")}
            </span>
            <span className="rounded-std bg-[var(--btn-primary-bg)] px-3 py-1.5 text-sm text-[var(--btn-primary-fg)]">
              {t("admin.theme.preview.contrastButton")}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-info-bg px-2.5 py-1 text-xs text-info">
            {t("admin.theme.preview.badgeInfo")}
          </span>
          <span className="rounded-full border border-ok-bd bg-ok-bg px-2.5 py-1 text-xs text-ok">
            {t("admin.theme.preview.badgeOk")}
          </span>
          <span className="rounded-full border border-warn-bd bg-warn-bg px-2.5 py-1 text-xs text-warn">
            {t("admin.theme.preview.badgeWarn")}
          </span>
          <span className="rounded-full border border-crit-bd bg-crit-bg px-2.5 py-1 text-xs text-crit">
            {t("admin.theme.preview.badgeCrit")}
          </span>
        </div>
      </div>
    </div>
  );
}

export interface ThemeGeneratorProps {
  locale: Locale;
  branding: TenantBranding;
  /** Gespeicherte Farbwelt; null = Instanz nutzt noch das Standard-Theme. */
  initial: ThemeConfig | null;
}

export function ThemeGenerator({ locale, branding, initial }: ThemeGeneratorProps) {
  const t = getT(locale);
  const start = useMemo(() => initial ?? fromBranding(branding), [initial, branding]);

  const [mode, setMode] = useState<ThemeMode>("light");
  const [anchors, setAnchors] = useState<ThemeAnchors>(start.anchors);
  const [light, setLight] = useState<ThemePalette>(start.light);
  const [dark, setDark] = useState<ThemePalette>(start.dark);
  const [custom, setCustom] = useState(initial !== null);
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");

  const current = mode === "light" ? light : dark;
  const setCurrent = (next: ThemePalette) => (mode === "light" ? setLight(next) : setDark(next));

  const snapshot = JSON.stringify({ anchors, light, dark });
  const [pristine, setPristine] = useState(snapshot);
  const dirty = snapshot !== pristine;
  const guard = useUnsavedGuard(dirty);

  const audit = useMemo(() => auditPalette(current), [current]);
  const problems = audit.filter((r) => !r.ok);
  const warnedTokens = useMemo(
    () => new Set(problems.flatMap((p) => [p.fg, p.bg])),
    [problems],
  );

  function regenerate() {
    const next = generateTheme(anchors);
    setLight(next.light);
    setDark(next.dark);
    setState("idle");
  }

  async function save(): Promise<boolean> {
    setState("saving");
    try {
      const res = await fetch("/api/v1/admin/settings/theme", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ anchors, light, dark }),
      });
      if (!res.ok) throw new Error("save");
      setPristine(JSON.stringify({ anchors, light, dark }));
      setCustom(true);
      setState("done");
      return true;
    } catch {
      setState("error");
      return false;
    }
  }

  async function reset() {
    setState("saving");
    try {
      const res = await fetch("/api/v1/admin/settings/theme", { method: "DELETE" });
      if (!res.ok) throw new Error("reset");
      const base = fromBranding(branding);
      setAnchors(base.anchors);
      setLight(base.light);
      setDark(base.dark);
      setPristine(JSON.stringify(base));
      setCustom(false);
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <div className="flex min-w-0 flex-col gap-6">
        <section className="rounded-card border border-hairline bg-surface p-6">
          <h2 className="mb-1 font-semibold tracking-[-0.3px]">{t("admin.theme.generator.title")}</h2>
          <p className="mb-4 text-sm text-ink-muted">{t("admin.theme.generator.hint")}</p>

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
                <span className="text-sm text-ink-muted">{t("admin.theme.anchor.brand")}</span>
                <div className="flex items-center gap-2">
                  <HexInput
                    value={anchors.brand}
                    label={t("admin.theme.anchor.brand")}
                    onChange={(brand) => setAnchors((a) => ({ ...a, brand }))}
                  />
                </div>
              </div>
              <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
                <span className="text-sm text-ink-muted">{t("admin.theme.anchor.accent")}</span>
                <div className="flex items-center gap-2">
                  <HexInput
                    value={anchors.accent}
                    label={t("admin.theme.anchor.accent")}
                    onChange={(accent) => setAnchors((a) => ({ ...a, accent }))}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <Segmented
                label={t("admin.theme.anchor.neutral")}
                value={anchors.neutral}
                options={NEUTRAL_TONES.map((v) => ({ value: v, label: t(NEUTRAL_LABELS[v]) }))}
                onChange={(neutral) => setAnchors((a) => ({ ...a, neutral }))}
              />
              <Segmented
                label={t("admin.theme.anchor.surface")}
                value={anchors.surface}
                options={SURFACE_STYLES.map((v) => ({ value: v, label: t(SURFACE_LABELS[v]) }))}
                onChange={(surface) => setAnchors((a) => ({ ...a, surface }))}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={regenerate}>{t("admin.theme.generate")}</Button>
              <span className="text-xs text-ink-muted">{t("admin.theme.generateHint")}</span>
            </div>
          </div>
        </section>

        <section className="rounded-card border border-hairline bg-surface p-6">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold tracking-[-0.3px]">{t("admin.theme.tune.title")}</h2>
            <div className="flex gap-1 rounded-std border border-hairline bg-surface-raised p-1">
              {(["light", "dark"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={
                    "rounded-[6px] px-3 py-1.5 text-sm transition-colors " +
                    (mode === m ? "bg-brand text-brand-fg" : "text-ink hover:bg-tint")
                  }
                >
                  {t(m === "light" ? "admin.theme.mode.light" : "admin.theme.mode.dark")}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-4 text-sm text-ink-muted">{t("admin.theme.tune.hint")}</p>

          <div className="flex flex-col gap-6">
            {THEME_TOKEN_GROUPS.map((group) => (
              <div key={group} className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {t(GROUP_LABELS[group])}
                </h3>
                {tokensOfGroup(group).map((token) => (
                  <ColorField
                    key={token}
                    token={token}
                    label={t(TOKEN_LABELS[token])}
                    value={current[token]}
                    warned={warnedTokens.has(token)}
                    warnLabel={t("admin.theme.contrast.warnLabel")}
                    onChange={(hex) => {
                      setCurrent({ ...current, [token]: hex });
                      setState("idle");
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void save()} disabled={state === "saving"}>
            {t("admin.theme.save")}
          </Button>
          <Button variant="ghost" onClick={() => void reset()} disabled={state === "saving" || !custom}>
            {t("admin.theme.reset")}
          </Button>
          <span aria-live="polite" className="text-xs">
            {state === "error" ? (
              <span className="text-crit">{t("admin.theme.error.generic")}</span>
            ) : state === "done" ? (
              <span className="text-ok">{t("admin.theme.saved")}</span>
            ) : custom ? (
              <span className="text-ink-muted">{t("admin.theme.active")}</span>
            ) : (
              <span className="text-ink-muted">{t("admin.theme.inactive")}</span>
            )}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
        <section className="rounded-card border border-hairline bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold tracking-[-0.3px]">
            {t("admin.theme.preview.title")}
          </h2>
          <Preview palette={current} locale={locale} />
        </section>

        <section className="rounded-card border border-hairline bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold tracking-[-0.3px]">
            {t("admin.theme.contrast.title")}
          </h2>
          <p className="mb-3 text-xs text-ink-muted">{t("admin.theme.contrast.hint")}</p>
          <ul className="flex flex-col gap-1.5">
            {audit.map((r) => (
              <li key={`${r.fg}-${r.bg}`} className="flex items-start gap-2 text-xs">
                {r.ok ? (
                  <CheckIcon width={14} height={14} className="mt-0.5 shrink-0 text-ok" />
                ) : (
                  <WarnIcon width={14} height={14} className="mt-0.5 shrink-0 text-warn" />
                )}
                <span className="min-w-0 flex-1 text-ink-muted">
                  {t("admin.theme.contrast.pair", {
                    fg: t(TOKEN_LABELS[r.fg]),
                    bg: t(TOKEN_LABELS[r.bg]),
                  })}
                </span>
                <span className={r.ok ? "shrink-0 text-ink-muted" : "shrink-0 text-warn"}>
                  {r.ratio.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
          {problems.length === 0 ? (
            <p className="mt-3 text-xs text-ok">{t("admin.theme.contrast.allOk")}</p>
          ) : (
            <p className="mt-3 text-xs text-warn">
              {t("admin.theme.contrast.problems", { n: problems.length })}
            </p>
          )}
        </section>
      </div>

      <UnsavedGuardDialog
        locale={locale}
        href={guard.pendingHref}
        onCancel={guard.cancel}
        onSave={save}
        onDiscard={() => {
          const p = JSON.parse(pristine) as ThemeConfig;
          setAnchors(p.anchors);
          setLight(p.light);
          setDark(p.dark);
        }}
      />
    </div>
  );
}
