"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote } from "@/components/auth/notes";
import { TurnstileWidget } from "@/components/security/turnstile-widget";

/** Ergebnis eines erfolgreichen Provisionings (Antwort-Shape der Create-Route). */
export interface CreatedHelpCenter {
  slug: string;
  name: string;
  helpCenterUrl: string;
  ownerSetupDevLink?: string;
}

type Availability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "unavailable"; reason: "taken" | "reserved" | "invalid_format" };

/**
 * Wizard zum Erstellen eines Hilfezentrums (Punkt 4b): Name → Subdomain (mit
 * Live-Verfügbarkeitsprüfung gegen /api/v1/operator/subdomain-available) →
 * Sprache → optionales Branding. Absenden → POST /api/v1/operator/help-centers.
 * Alle Texte via t(); same-origin-Fetch (Session-Cookie automatisch).
 */
export function CreateWizard({
  locale,
  onCreated,
  onCancel,
  turnstileSiteKey = null,
}: {
  locale: Locale;
  onCreated: (result: CreatedHelpCenter) => void;
  onCancel: () => void;
  /** Turnstile-Site-Key (public); `null` = Umgebung ohne Bot-Schutz (dev). */
  turnstileSiteKey?: string | null;
}) {
  const t = getT(locale);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [defaultLocale, setDefaultLocale] = useState<Locale>(locale);
  const [colorPrimary, setColorPrimary] = useState("#4f46e5");
  const [colorAccent, setColorAccent] = useState("#06b6d4");
  const [useBranding, setUseBranding] = useState(false);
  const [availability, setAvailability] = useState<Availability>({ state: "idle" });
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);

  // Live-Verfügbarkeit (debounced) — die Antwort trägt available/reason.
  useEffect(() => {
    if (slug.length === 0) {
      setAvailability({ state: "idle" });
      return;
    }
    setAvailability({ state: "checking" });
    const mySeq = ++seq.current;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/operator/subdomain-available?slug=${encodeURIComponent(slug)}`,
          { headers: { accept: "application/json" } },
        );
        const data = (await res.json()) as {
          available: boolean;
          reason?: "taken" | "reserved" | "invalid_format";
        };
        if (mySeq !== seq.current) return; // veraltete Antwort verwerfen
        setAvailability(
          data.available
            ? { state: "available" }
            : { state: "unavailable", reason: data.reason ?? "invalid_format" },
        );
      } catch {
        if (mySeq === seq.current) setAvailability({ state: "idle" });
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [slug]);

  function availabilityNote() {
    switch (availability.state) {
      case "checking":
        return <span className="text-ink-muted">{t("operator.wizard.slugChecking")}</span>;
      case "available":
        return <span className="text-ok">{t("operator.wizard.slugAvailable")}</span>;
      case "unavailable":
        return (
          <span className="text-crit">
            {availability.reason === "taken"
              ? t("operator.wizard.slugTaken")
              : availability.reason === "reserved"
                ? t("operator.wizard.slugReserved")
                : t("operator.wizard.slugInvalid")}
          </span>
        );
      default:
        return null;
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/v1/operator/help-centers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Turnstile-Token (better-auth-Header-Konvention, geprüft in operator.ts).
          ...(turnstileToken ? { "x-captcha-response": turnstileToken } : {}),
        },
        body: JSON.stringify({
          name,
          slug,
          defaultLocale,
          ...(useBranding ? { colorPrimary, colorAccent } : {}),
        }),
      });
      if (res.status === 201) {
        onCreated((await res.json()) as CreatedHelpCenter);
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(
        data?.error === "captcha_required" || data?.error === "captcha_failed"
          ? t("security.captchaFailed")
          : t("operator.wizard.error"),
      );
    } catch {
      setError(t("operator.wizard.error"));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    name.trim().length >= 2 &&
    availability.state === "available" &&
    !busy &&
    (turnstileSiteKey === null || turnstileToken !== null);

  return (
    <section className="w-full rounded-card border border-hairline bg-surface p-6 sm:p-7">
      <header className="mb-5 flex flex-col gap-1.5">
        <h1 className="text-xl font-bold text-ink">{t("operator.wizard.title")}</h1>
        <p className="text-sm text-ink-muted">{t("operator.wizard.subtitle")}</p>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Input
          label={t("operator.wizard.nameLabel")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("operator.wizard.namePlaceholder")}
          required
        />

        <div className="flex flex-col gap-1.5">
          <Input
            label={t("operator.wizard.slugLabel")}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder={t("operator.wizard.slugPlaceholder")}
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-muted">
              {slug || t("operator.wizard.slugPlaceholder")}
              {t("operator.wizard.slugSuffix")}
            </span>
            <span aria-live="polite">{availabilityNote()}</span>
          </div>
          <p className="text-xs text-ink-muted">{t("operator.wizard.slugHint")}</p>
        </div>

        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-sm text-ink-muted">{t("operator.wizard.localeLabel")}</span>
          <select
            value={defaultLocale}
            onChange={(e) => setDefaultLocale(e.target.value as Locale)}
            className="w-full rounded-std border border-hairline bg-surface-raised px-3 py-2 text-base text-ink"
          >
            <option value="de">{t("operator.wizard.localeDe")}</option>
            <option value="en">{t("operator.wizard.localeEn")}</option>
          </select>
        </label>

        <fieldset className="flex flex-col gap-3 rounded-std border border-hairline p-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={useBranding}
              onChange={(e) => setUseBranding(e.target.checked)}
            />
            {t("operator.wizard.brandingLabel")}
          </label>
          {useBranding ? (
            <div className="flex gap-4">
              <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
                {t("operator.wizard.colorPrimary")}
                <input
                  type="color"
                  value={colorPrimary}
                  onChange={(e) => setColorPrimary(e.target.value)}
                  aria-label={t("operator.wizard.colorPrimary")}
                  className="h-9 w-16 rounded-std border border-hairline bg-surface-raised"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
                {t("operator.wizard.colorAccent")}
                <input
                  type="color"
                  value={colorAccent}
                  onChange={(e) => setColorAccent(e.target.value)}
                  aria-label={t("operator.wizard.colorAccent")}
                  className="h-9 w-16 rounded-std border border-hairline bg-surface-raised"
                />
              </label>
            </div>
          ) : null}
        </fieldset>

        {turnstileSiteKey ? (
          <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} language={locale} />
        ) : null}

        <ErrorNote>{error || null}</ErrorNote>

        <div className="flex gap-3">
          <Button type="submit" disabled={!canSubmit} className="justify-center">
            {busy ? t("operator.wizard.submitting") : t("operator.wizard.submit")}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {t("operator.wizard.cancel")}
          </Button>
        </div>
      </form>
    </section>
  );
}
