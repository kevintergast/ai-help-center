"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/**
 * BRANDING-PFLEGE (ersetzt das tote Scaffold „UploadPlaceholder + Dummy-
 * Speichern" — der gemeldete Bug „Logo hochladen/Einstellungen speichern geht
 * nicht"): verdrahtet die seit 0003 existierende Branding-API.
 *
 *  - Logo HELL + DUNKEL (0023): POST/DELETE /api/v1/admin/branding/logo
 *    (?variant=dark), roher Body, Serverregeln PNG/JPEG/WebP ≤ 1 MB werden
 *    client-seitig vorgeprüft (freundliche Fehler statt 4xx).
 *  - Farben: PUT /api/v1/admin/branding — strikt Hex; primaryFg wird
 *    unverändert mitgeführt (API verlangt alle drei Felder).
 *  - Sprache: PUT /api/v1/admin/settings/locale (owner-Gate) — lädt danach
 *    neu, weil die gesamte Instanz-UI die Sprache wechselt.
 *
 * Nach Logo-/Farb-Änderungen: router.refresh() — Branding kommt SSR aufs
 * <html> bzw. als ?v=-gebustete Logo-URL, der Server muss neu rendern.
 */

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 1024 * 1024;

type SlotState = "idle" | "busy" | "done" | "tooLarge" | "badType" | "error";

function LogoSlot({
  locale,
  variant,
  currentUrl,
  onChanged,
}: {
  locale: Locale;
  variant: "light" | "dark";
  currentUrl: string | null;
  onChanged: () => void;
}) {
  const t = getT(locale);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<SlotState>("idle");

  async function upload(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) return setState("badType");
    if (file.size > MAX_BYTES) return setState("tooLarge");
    setState("busy");
    try {
      const res = await fetch(`/api/v1/admin/branding/logo?variant=${variant}`, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!res.ok) return setState("error");
      setState("done");
      onChanged();
    } catch {
      setState("error");
    }
  }

  async function remove() {
    setState("busy");
    try {
      const res = await fetch(`/api/v1/admin/branding/logo?variant=${variant}`, {
        method: "DELETE",
      });
      if (!res.ok) return setState("error");
      setState("done");
      onChanged();
    } catch {
      setState("error");
    }
  }

  const label = variant === "dark" ? t("admin.settings.logoDark") : t("admin.settings.logoLight");
  return (
    <div className="flex flex-col gap-2 rounded-card border border-hairline bg-tint p-4">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="flex items-center gap-4">
        <span
          className={`grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-comfy border border-hairline ${
            variant === "dark" ? "bg-[#1a1a1a]" : "bg-white"
          }`}
        >
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- R2-Logo mit ?v=-Buster; next/image im Worker nicht verfügbar.
            <img src={currentUrl} alt={label} className="max-h-10 max-w-12 object-contain" />
          ) : (
            <span className="text-xs text-ink-muted">{t("admin.settings.logoNone")}</span>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ALLOWED_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={state === "busy"}
            onClick={() => fileRef.current?.click()}
          >
            {state === "busy" ? t("admin.settings.logoUploading") : t("admin.settings.logoUpload")}
          </Button>
          {currentUrl ? (
            <Button
              type="button"
              size="sm"
              variant="cream"
              disabled={state === "busy"}
              onClick={() => void remove()}
            >
              {t("admin.settings.logoRemove")}
            </Button>
          ) : null}
        </div>
      </div>
      <span aria-live="polite" className="text-xs">
        {state === "done" ? (
          <span className="text-ok">{t("admin.settings.logoSaved")}</span>
        ) : state === "tooLarge" ? (
          <span className="text-crit">{t("admin.settings.logoTooLarge")}</span>
        ) : state === "badType" ? (
          <span className="text-crit">{t("admin.settings.logoBadType")}</span>
        ) : state === "error" ? (
          <span className="text-crit">{t("admin.settings.seo.error")}</span>
        ) : variant === "dark" ? (
          <span className="text-ink-muted">{t("admin.settings.logoDarkHint")}</span>
        ) : null}
      </span>
    </div>
  );
}

export function BrandingManager({
  locale,
  initialPrimary,
  initialAccent,
  primaryFg,
  logoUrl,
  logoDarkUrl,
}: {
  locale: Locale;
  initialPrimary: string;
  initialAccent: string;
  /** Wird unverändert mitgesendet (API verlangt alle drei Farben). */
  primaryFg: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
}) {
  const t = getT(locale);
  const router = useRouter();
  const [primary, setPrimary] = useState(initialPrimary);
  const [accent, setAccent] = useState(initialAccent);
  const [colorState, setColorState] = useState<"idle" | "saving" | "saved" | "invalid" | "error">(
    "idle",
  );
  const [lang, setLang] = useState<Locale>(locale);
  const [langState, setLangState] = useState<"idle" | "saving" | "saved" | "forbidden" | "error">(
    "idle",
  );

  async function saveColors(e: FormEvent) {
    e.preventDefault();
    setColorState("saving");
    try {
      const res = await fetch("/api/v1/admin/branding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          colorPrimary: primary.trim(),
          colorAccent: accent.trim(),
          colorPrimaryFg: primaryFg,
        }),
      });
      if (res.ok) {
        setColorState("saved");
        router.refresh(); // SSR-Branding (<html>-Variablen) neu rendern
        return;
      }
      setColorState(res.status === 400 ? "invalid" : "error");
    } catch {
      setColorState("error");
    }
  }

  async function saveLanguage(e: FormEvent) {
    e.preventDefault();
    setLangState("saving");
    try {
      const res = await fetch("/api/v1/admin/settings/locale", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: lang }),
      });
      if (res.ok) {
        setLangState("saved");
        // Die GANZE Instanz-UI wechselt die Sprache → vollständig neu laden.
        window.location.reload();
        return;
      }
      setLangState(res.status === 403 ? "forbidden" : "error");
    } catch {
      setLangState("error");
    }
  }

  function ColorField({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) {
    // Der native Color-Picker kann nur #rrggbb — für den Swatch reicht das;
    // das Textfeld bleibt die Wahrheit (API validiert strikt).
    const pickerValue = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
    return (
      <div>
        <span className="mb-1.5 block text-sm text-ink-muted">{label}</span>
        <div className="flex items-center gap-3">
          <input
            type="color"
            aria-label={label}
            value={pickerValue}
            onChange={(e) => {
              onChange(e.target.value);
              setColorState("idle");
            }}
            className="h-9 w-9 shrink-0 cursor-pointer rounded-comfy border border-hairline bg-transparent p-0.5"
          />
          <Input
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setColorState("idle");
            }}
            className="w-36 font-mono uppercase"
            aria-label={label}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <LogoSlot
          locale={locale}
          variant="light"
          currentUrl={logoUrl}
          onChanged={() => router.refresh()}
        />
        <LogoSlot
          locale={locale}
          variant="dark"
          currentUrl={logoDarkUrl}
          onChanged={() => router.refresh()}
        />
      </div>

      <form onSubmit={saveColors} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <ColorField label={t("admin.settings.primaryColor")} value={primary} onChange={setPrimary} />
          <ColorField label={t("admin.settings.accentColor")} value={accent} onChange={setAccent} />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={colorState === "saving"}>
            {colorState === "saving"
              ? t("admin.settings.colorsSaving")
              : t("admin.settings.colorsSave")}
          </Button>
          <span aria-live="polite" className="text-xs">
            {colorState === "saved" ? (
              <span className="text-ok">{t("admin.settings.colorsSaved")}</span>
            ) : colorState === "invalid" ? (
              <span className="text-crit">{t("admin.settings.colorsInvalid")}</span>
            ) : colorState === "error" ? (
              <span className="text-crit">{t("admin.settings.seo.error")}</span>
            ) : null}
          </span>
        </div>
      </form>

      <form onSubmit={saveLanguage} className="flex flex-col gap-3 border-t border-hairline pt-5" noValidate>
        <div className="max-w-xs">
          <span className="mb-1.5 block text-sm text-ink-muted">{t("admin.settings.language")}</span>
          <Select
            options={[
              { value: "de", label: "Deutsch" },
              { value: "en", label: "English" },
            ]}
            value={lang}
            onValueChange={(v) => {
              setLang(v === "en" ? "en" : "de");
              setLangState("idle");
            }}
            aria-label={t("admin.settings.language")}
            className="w-full"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="cream" disabled={langState === "saving"}>
            {langState === "saving"
              ? t("admin.settings.languageSaving")
              : t("admin.settings.languageSave")}
          </Button>
          <span aria-live="polite" className="text-xs">
            {langState === "forbidden" ? (
              <span className="text-crit">{t("admin.settings.languageOwnerOnly")}</span>
            ) : langState === "error" ? (
              <span className="text-crit">{t("admin.settings.seo.error")}</span>
            ) : null}
          </span>
        </div>
      </form>
    </div>
  );
}
