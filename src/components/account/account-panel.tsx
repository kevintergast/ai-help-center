"use client";

import { useState } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import { authClient } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordField } from "@/components/auth/password-field";

/**
 * KONTO-VERWALTUNG für JEDE Rolle.
 *
 * Bisher gab es sie gar nicht: Das Konto-Menü bot Identität, zwei Links und
 * Abmelden. Wer sein Passwort ändern wollte, musste sich selbst eine
 * „Passwort vergessen"-Mail schicken, und Zwei-Faktor konnte man nur
 * einrichten, wenn ein Guard einen dorthin zwang.
 *
 * ZWEI-FAKTOR unterscheidet sich nach Rolle, und das steht hier auch so da:
 *  - TEAM-ROLLEN (Redaktion/Admin/Besitzer) brauchen ihn zwingend. Das ist
 *    keine Einstellung, sondern baulich: `evaluateTeamAccess` prüft ihn VOR
 *    der Rolle, und eine Team-Rolle wird überhaupt erst nach bestandenem
 *    Enrollment wirksam. Abschalten hieße, sich selbst aus dem
 *    Verwaltungsbereich auszusperren — deshalb der Warnhinweis.
 *  - NORMALE NUTZER (Konto nur für gespeicherte Artikel) müssen nicht, dürfen
 *    aber. Genau das ging vorher nicht, weil kein Weg zur Einrichtung führte.
 */

type State = "idle" | "saving" | "done";

export function AccountPanel({
  locale,
  name,
  email,
  role,
  twoFactorEnabled,
}: {
  locale: Locale;
  name: string | null;
  email: string;
  role: string;
  twoFactorEnabled: boolean;
}) {
  const t = getT(locale);
  const isTeam = role === "content" || role === "admin" || role === "owner";

  const [displayName, setDisplayName] = useState(name ?? "");
  const [nameState, setNameState] = useState<State>("idle");
  const [nameError, setNameError] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwState, setPwState] = useState<State>("idle");
  const [pwError, setPwError] = useState<MessageKey | null>(null);

  async function saveName() {
    setNameState("saving");
    setNameError(false);
    try {
      const { error } = await authClient.updateUser({ name: displayName.trim() });
      if (error) throw new Error("update");
      setNameState("done");
    } catch {
      setNameError(true);
      setNameState("idle");
    }
  }

  async function savePassword() {
    setPwState("saving");
    setPwError(null);
    try {
      const { error } = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        // Andere Sitzungen beenden: Wer sein Passwort ändert, tut das oft,
        // WEIL er jemanden aussperren will. Alles andere wäre die halbe Tat.
        revokeOtherSessions: true,
      });
      if (error) {
        setPwError(
          error.status === 400 ? "account.password.errorWrong" : "account.password.errorGeneric",
        );
        setPwState("idle");
        return;
      }
      setCurrent("");
      setNext("");
      setPwState("done");
    } catch {
      setPwError("account.password.errorGeneric");
      setPwState("idle");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ——— Identität ——— */}
      <section className="rounded-card border border-hairline bg-surface p-5">
        <h2 className="mb-1 font-semibold tracking-[-0.3px]">{t("account.profile")}</h2>
        <p className="mb-4 text-xs text-ink-muted">{t("account.emailFixed", { email })}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label={t("account.name")}
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setNameState("idle");
            }}
            placeholder={t("account.namePlaceholder")}
            className="min-w-[14rem] flex-1"
          />
          <Button onClick={() => void saveName()} disabled={nameState === "saving"}>
            {t("account.save")}
          </Button>
        </div>
        <span aria-live="polite" className="mt-2 block text-xs">
          {nameError ? (
            <span className="text-crit">{t("account.errorGeneric")}</span>
          ) : nameState === "done" ? (
            <span className="text-ok">{t("account.saved")}</span>
          ) : null}
        </span>
      </section>

      {/* ——— Passwort ——— */}
      <section className="rounded-card border border-hairline bg-surface p-5">
        <h2 className="mb-1 font-semibold tracking-[-0.3px]">{t("account.password")}</h2>
        <p className="mb-4 text-xs text-ink-muted">{t("account.passwordHint")}</p>
        <div className="flex max-w-md flex-col gap-3">
          <PasswordField
            locale={locale}
            label={t("account.password.current")}
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              setPwState("idle");
            }}
            autoComplete="current-password"
          />
          <PasswordField
            locale={locale}
            label={t("account.password.new")}
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              setPwState("idle");
            }}
            autoComplete="new-password"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void savePassword()}
              disabled={pwState === "saving" || current.length === 0 || next.length === 0}
            >
              {t("account.password.change")}
            </Button>
            <span aria-live="polite" className="text-xs">
              {pwError ? (
                <span className="text-crit">{t(pwError)}</span>
              ) : pwState === "done" ? (
                <span className="text-ok">{t("account.password.changed")}</span>
              ) : null}
            </span>
          </div>
        </div>
      </section>

      {/* ——— Zwei-Faktor ——— */}
      <section className="rounded-card border border-hairline bg-surface p-5">
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold tracking-[-0.3px]">{t("account.mfa")}</h2>
          <Badge tone={twoFactorEnabled ? "ok" : "neutral"} dot>
            {twoFactorEnabled ? t("account.mfa.on") : t("account.mfa.off")}
          </Badge>
        </div>
        <p className="mb-4 text-xs text-ink-muted">
          {isTeam ? t("account.mfa.hintTeam") : t("account.mfa.hintUser")}
        </p>
        {twoFactorEnabled ? (
          isTeam ? (
            // Abschalten würde den Verwaltungsbereich verschließen — der
            // Guard prüft den zweiten Faktor VOR der Rolle. Statt eines
            // Knopfes, der ins Leere führt, steht hier die Erklärung.
            <p className="text-sm text-ink-muted">{t("account.mfa.lockedTeam")}</p>
          ) : (
            <Link href="/mfa/setup" className="text-sm text-brand hover:underline">
              {t("account.mfa.manage")}
            </Link>
          )
        ) : (
          <Link
            href="/mfa/setup"
            className="inline-flex items-center rounded-std bg-[var(--btn-primary-bg)] px-3.5 py-2 text-sm text-[var(--btn-primary-fg)] shadow-inset transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:shadow-focusglow"
          >
            {t("account.mfa.setUp")}
          </Link>
        )}
      </section>
    </div>
  );
}
