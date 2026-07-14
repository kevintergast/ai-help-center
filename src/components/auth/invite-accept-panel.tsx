"use client";

import { useState } from "react";
import Link from "next/link";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { ErrorNote, PendingNote } from "./notes";

/** Fehlercode der Accept-Route → nutzerfreundlicher i18n-Key. */
const ACCEPT_ERROR: Record<string, MessageKey> = {
  already_team_member: "auth.invite.alreadyMember",
  invitation_expired: "auth.invite.expired",
  email_mismatch: "auth.invite.emailMismatch",
  invitation_not_found: "auth.invite.notFound",
};

/**
 * EINLADUNG ANNEHMEN (Punkt 4a). Nutzt den bestehenden Endpunkt
 * POST /api/v1/invitations/accept (Session-Pflicht, KEIN Team-Gate) — cookie-
 * basiert per same-origin-fetch, keine Tokens im JS. Ohne passende Session führt
 * die Seite durch Anmeldung/Registrierung (der Invite-Token bleibt in der URL
 * erhalten). Nach Erfolg wird die Zielrolle geparkt und die Seite verweist auf
 * das TOTP-Enrollment (Team-Rollen brauchen MFA), das die Promotion auslöst.
 */
export function InviteAcceptPanel({ locale, token }: { locale: Locale; token: string | null }) {
  const t = getT(locale);
  const { data: session, isPending } = useSession();
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!token) return <ErrorNote>{t("auth.invite.missingToken")}</ErrorNote>;

  const loginHref = `/login?redirect=${encodeURIComponent(`/invite/accept?token=${token}`)}`;
  const signupHref = `/signup?redirect=${encodeURIComponent(`/invite/accept?token=${token}`)}`;

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setAccepted(true);
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(t(ACCEPT_ERROR[payload.error ?? ""] ?? "auth.error.generic"));
    } catch {
      setError(t("auth.error.network"));
    } finally {
      setBusy(false);
    }
  }

  if (accepted) {
    return (
      <div className="flex flex-col gap-5">
        <PendingNote tone="ok">{t("auth.invite.successBody")}</PendingNote>
        <Link href="/mfa/setup" className="block">
          <Button type="button" className="w-full justify-center">
            {t("auth.invite.setupMfa")}
          </Button>
        </Link>
      </div>
    );
  }

  if (isPending) {
    return <PendingNote tone="info">{t("auth.submitting")}</PendingNote>;
  }

  if (!session) {
    return (
      <div className="flex flex-col gap-5">
        <PendingNote tone="info">{t("auth.invite.needLogin")}</PendingNote>
        <div className="flex gap-2">
          <Link href={loginHref} className="flex-1">
            <Button type="button" className="w-full justify-center">
              {t("auth.invite.login")}
            </Button>
          </Link>
          <Link href={signupHref} className="flex-1">
            <Button type="button" variant="cream" className="w-full justify-center">
              {t("auth.invite.signup")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-muted">{t("auth.invite.body")}</p>
      <ErrorNote>{error || null}</ErrorNote>
      <Button type="button" onClick={accept} disabled={busy} className="w-full justify-center">
        {busy ? t("auth.submitting") : t("auth.invite.accept")}
      </Button>
    </div>
  );
}
