"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import { Button } from "@/components/ui/button";
import { ErrorNote, PendingNote } from "@/components/auth/notes";
import { signOut } from "@/lib/auth-client";
import { CreateWizard, type CreatedHelpCenter } from "./create-wizard";

interface HelpCenterItem {
  tenantId: string;
  slug: string;
  name: string;
  defaultLocale: string;
  helpCenterUrl: string;
}

type View = "list" | "wizard" | "success";

/**
 * Operator-Konsole (Punkt 4b): „Meine Hilfezentren" + Erstellen-Flow.
 * - Nicht eingeloggt → Anmelde-Prompt (Links zu den 4a-Formularen mit
 *   `?redirect=/console`).
 * - Eingeloggt → Liste der EIGENEN Hilfezentren (Fetch), Wizard, Erfolgsseite
 *   mit Link zu `<slug>.hallofhelp.com` + Hinweis „Passwort + MFA einrichten".
 */
export function OperatorConsole({
  locale,
  signedIn,
  turnstileSiteKey = null,
}: {
  locale: Locale;
  signedIn: boolean;
  /** Turnstile-Site-Key (public) für den Erstellungs-Wizard; `null` = dev ohne Schutz. */
  turnstileSiteKey?: string | null;
}) {
  const t = getT(locale);
  const [view, setView] = useState<View>("list");
  const [items, setItems] = useState<HelpCenterItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [created, setCreated] = useState<CreatedHelpCenter | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/v1/operator/help-centers", {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { helpCenters: HelpCenterItem[] };
      setItems(data.helpCenters);
    } catch {
      setLoadError(true);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  if (!signedIn) {
    return (
      <section className="w-full rounded-card border border-hairline bg-surface p-6 sm:p-7">
        <h1 className="text-xl font-bold text-ink">{t("operator.console.title")}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t("operator.console.signInPrompt")}</p>
        <div className="mt-5 flex gap-3">
          <Link href="/login?redirect=/console">
            <Button>{t("operator.console.signIn")}</Button>
          </Link>
          <Link href="/signup">
            <Button variant="ghost">{t("operator.console.signUp")}</Button>
          </Link>
        </div>
      </section>
    );
  }

  if (view === "wizard") {
    return (
      <CreateWizard
        locale={locale}
        turnstileSiteKey={turnstileSiteKey}
        onCancel={() => setView("list")}
        onCreated={(result) => {
          setCreated(result);
          setView("success");
        }}
      />
    );
  }

  if (view === "success" && created) {
    return (
      <section className="w-full rounded-card border border-hairline bg-surface p-6 sm:p-7">
        <h1 className="text-xl font-bold text-ink">{t("operator.success.title")}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t("operator.success.body")}</p>
        <a
          href={created.helpCenterUrl}
          className="mt-1 block text-base font-semibold text-brand hover:underline"
        >
          {created.helpCenterUrl}
        </a>

        <div className="mt-5">
          <PendingNote tone="info">
            <strong className="block text-ink">{t("operator.success.setupTitle")}</strong>
            {t("operator.success.setupBody")}
            {created.ownerSetupDevLink ? (
              <span className="mt-2 block break-all text-xs">
                {t("operator.success.devLink")}{" "}
                <a href={created.ownerSetupDevLink} className="text-brand hover:underline">
                  {created.ownerSetupDevLink}
                </a>
              </span>
            ) : null}
          </PendingNote>
        </div>

        <div className="mt-5 flex gap-3">
          <a href={created.helpCenterUrl}>
            <Button>{t("operator.success.openHelpCenter")}</Button>
          </a>
          <Button
            variant="ghost"
            onClick={() => {
              setCreated(null);
              setView("list");
              void load();
            }}
          >
            {t("operator.success.backToConsole")}
          </Button>
        </div>
      </section>
    );
  }

  // view === "list"
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink">{t("operator.console.title")}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t("operator.console.subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={() => setView("wizard")}>{t("operator.console.create")}</Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await signOut();
              window.location.assign("/console");
            }}
          >
            {t("operator.console.signOut")}
          </Button>
        </div>
      </header>

      {loadError ? <ErrorNote>{t("operator.console.loadError")}</ErrorNote> : null}

      {items === null ? null : items.length === 0 ? (
        <section className="rounded-card border border-dashed border-hairline bg-surface p-8 text-center">
          <p className="text-sm text-ink-muted">{t("operator.console.empty")}</p>
          <div className="mt-4 flex justify-center">
            <Button onClick={() => setView("wizard")}>{t("operator.console.emptyCta")}</Button>
          </div>
        </section>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((hc) => (
            <li
              key={hc.tenantId}
              className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{hc.name}</p>
                <p className="truncate text-sm text-ink-muted">
                  {hc.slug}
                  {t("operator.wizard.slugSuffix")}
                </p>
              </div>
              <a href={hc.helpCenterUrl} className="shrink-0">
                <Button variant="ghost" size="sm">
                  {t("operator.console.open")}
                </Button>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
