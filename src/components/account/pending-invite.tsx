"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * OFFENE EINLADUNG im eigenen Konto annehmen — der zweite Weg neben dem Link
 * aus der Einladungs-Mail.
 *
 * Warum es den braucht: Der Token steht ausschließlich in der Mail und liegt
 * in der Datenbank nur als Hash. Wer die Mail nicht findet, hatte bisher
 * KEINEN Weg — auch nicht als Angemeldeter, dessen Adresse genau die
 * eingeladene ist. Diese Karte macht die Einladung dort sichtbar, wo man sie
 * ohnehin sucht.
 *
 * Die Frist gilt hier genauso: Abgelaufene Einladungen liefert `/mine` gar
 * nicht erst aus, sonst wäre der Ablauf über das Konto umgehbar.
 *
 * ZWEI-FAKTOR ist der eigentliche Knackpunkt der Annahme. Die Rolle wird beim
 * Annehmen nur GEPARKT; wirksam wird sie erst nach vollständigem Enrollment.
 * Wer nach dem Annehmen nichts weiter sieht, hält das für kaputt — deshalb
 * führt die Karte danach sichtbar zum nächsten Schritt und sagt, dass er
 * nötig ist. Abbrechen geht in beiden Stufen; die Einladung bleibt dann als
 * geparkte Rolle bestehen und der Weg steht beim nächsten Besuch wieder offen.
 */

const ROLE_LABELS: Record<string, MessageKey> = {
  content: "admin.team.role.content",
  admin: "admin.team.role.admin",
};

const ERROR_KEYS: Record<string, MessageKey> = {
  invitation_expired: "account.invite.error.expired",
  email_mismatch: "account.invite.error.mismatch",
  already_team_member: "account.invite.error.alreadyMember",
  invitation_role_conflict: "account.invite.error.conflict",
};

interface PendingInvitation {
  id: string;
  role: string;
  expiresAt: number;
}

export function PendingInvite({
  locale,
  twoFactorEnabled,
}: {
  locale: Locale;
  /** Entscheidet, ob nach dem Annehmen noch der Zwei-Faktor-Schritt folgt. */
  twoFactorEnabled: boolean;
}) {
  const t = getT(locale);
  const [invitation, setInvitation] = useState<PendingInvitation | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/invitations/mine");
      if (!res.ok) return;
      const data = (await res.json()) as { invitation: PendingInvitation | null };
      setInvitation(data.invitation);
    } catch {
      /* Keine Einladung anzeigen ist der richtige Fehlerfall — nicht blockieren. */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept() {
    setBusy(true);
    setErrorKey(null);
    try {
      const res = await fetch("/api/v1/invitations/claim", { method: "POST" });
      if (res.ok) {
        setAccepted(true);
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setErrorKey(ERROR_KEYS[data?.error ?? ""] ?? "account.invite.error.generic");
      // Abgelaufen/weg: Karte beim nächsten Laden korrekt neu bewerten.
      await load();
    } catch {
      setErrorKey("account.invite.error.generic");
    } finally {
      setBusy(false);
    }
  }

  if (!invitation || dismissed) return null;

  const roleLabel = t(ROLE_LABELS[invitation.role] ?? "admin.team.role.content");

  // ——— Stufe 2: angenommen, Zwei-Faktor fehlt noch ———
  if (accepted && !twoFactorEnabled) {
    return (
      <section className="rounded-card border border-brand/40 bg-surface p-5">
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold tracking-[-0.3px]">{t("account.invite.mfaHeading")}</h2>
          <Badge tone="warn" dot>
            {t("account.invite.mfaBadge")}
          </Badge>
        </div>
        <p className="mb-4 text-sm text-ink-muted">
          {t("account.invite.mfaBody", { role: roleLabel })}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/mfa/setup"
            className="inline-flex items-center rounded-std bg-[var(--btn-primary-bg)] px-3.5 py-2 text-sm text-[var(--btn-primary-fg)] shadow-inset transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:shadow-focusglow"
          >
            {t("account.invite.mfaSetUp")}
          </Link>
          <Button variant="ghost" onClick={() => setDismissed(true)}>
            {t("account.invite.later")}
          </Button>
        </div>
      </section>
    );
  }

  // ——— Stufe 2b: angenommen, Zwei-Faktor stand schon ———
  if (accepted) {
    return (
      <section className="rounded-card border border-hairline bg-surface p-5">
        <h2 className="mb-1 font-semibold tracking-[-0.3px]">{t("account.invite.doneHeading")}</h2>
        <p className="text-sm text-ink-muted">{t("account.invite.doneBody", { role: roleLabel })}</p>
      </section>
    );
  }

  // ——— Stufe 1: Einladung liegt offen ———
  return (
    <section className="rounded-card border border-brand/40 bg-surface p-5">
      <h2 className="mb-1 font-semibold tracking-[-0.3px]">{t("account.invite.heading")}</h2>
      <p className="mb-4 text-sm text-ink-muted">
        {t("account.invite.body", { role: roleLabel })}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void accept()} disabled={busy}>
          {t("account.invite.accept")}
        </Button>
        <Button variant="ghost" onClick={() => setDismissed(true)} disabled={busy}>
          {t("account.invite.cancel")}
        </Button>
        <span aria-live="polite" className="text-xs">
          {errorKey ? <span className="text-crit">{t(errorKey)}</span> : null}
        </span>
      </div>
    </section>
  );
}
