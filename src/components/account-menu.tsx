"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { getT } from "@/i18n/t";
import { signOut } from "@/lib/auth-client";
import { isTeamRole, type HelpViewer } from "@/lib/auth/viewer";
import type { Locale } from "@/lib/tenant/types";
import { useClickOutside } from "@/lib/ui/use-click-outside";
import { cn } from "@/lib/ui/cn";
import { IconButton } from "@/components/ui/icon-button";
import { UserIcon, UserPlusIcon } from "@/components/ui/icons";

/**
 * GEMEINSAMES Konto-Menü für Hilfezentrum- UND Admin-Header (eine Quelle,
 * identisches Verhalten — User-Vorgabe 2026-07-15: „Avatar überall gleich").
 *
 * Anonym: Anmelden-Hinweis. Angemeldet: Identität + rollenbasierte Links
 * (Team-Rolle → Admin-Bereich, Operator-Instanz → Console) + Abmelden.
 * Links sind reine Navigation — Berechtigungen prüfen die Server-Gates.
 */
export function AccountMenu({
  locale,
  viewer,
  isOperator = false,
  showAdminLink = true,
}: {
  locale: Locale;
  viewer: HelpViewer | null;
  /** Operator-Instanz → „Meine Hilfezentren"-Link (/console). */
  isOperator?: boolean;
  /** Im Admin-Bereich selbst aus (redundanter Link auf die aktuelle Ansicht). */
  showAdminLink?: boolean;
}) {
  const t = getT(locale);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
    } finally {
      // Voller Reload: Server-Komponenten lesen die (nun leere) Session neu.
      window.location.assign("/");
    }
  }

  const linkRow =
    "flex w-full items-center rounded-comfy px-2 py-1.5 text-sm text-ink transition-colors hover:bg-tint";

  return (
    <div ref={ref} className="relative">
      <IconButton
        aria-label={t("hc.account")}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {viewer ? <UserIcon width={18} height={18} /> : <UserPlusIcon width={18} height={18} />}
      </IconButton>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-card border border-hairline bg-surface-raised p-4 shadow-focusglow">
          {viewer ? (
            <div className="flex flex-col gap-1">
              <p className="px-2 text-xs text-ink-muted">{t("hc.account.signedInAs")}</p>
              <p className="truncate px-2 text-sm font-medium text-ink">
                {viewer.name ?? viewer.email}
              </p>
              {viewer.name ? (
                <p className="truncate px-2 text-xs text-ink-muted">{viewer.email}</p>
              ) : null}

              <div className="my-2 h-px bg-hairline" aria-hidden />

              {showAdminLink && isTeamRole(viewer.role) ? (
                <Link href="/admin" className={linkRow} onClick={() => setOpen(false)}>
                  {t("hc.account.admin")}
                </Link>
              ) : null}
              {isOperator ? (
                <Link href="/console" className={linkRow} onClick={() => setOpen(false)}>
                  {t("hc.account.console")}
                </Link>
              ) : null}
              <button onClick={handleSignOut} disabled={busy} className={cn(linkRow, "text-left")}>
                {busy ? t("hc.account.signingOut") : t("hc.account.signOut")}
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-ink">{t("hc.accountPrompt")}</p>
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="mt-3 inline-flex w-full items-center justify-center rounded-std bg-[var(--btn-primary-bg)] px-3 py-2 text-sm text-[var(--btn-primary-fg)] shadow-inset transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:shadow-focusglow"
              >
                {t("hc.signIn")}
              </Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
