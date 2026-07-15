"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HelpViewer } from "@/lib/auth/viewer";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import { cn } from "@/lib/ui/cn";
import { AccountMenu } from "@/components/account-menu";
import { LogoWithClaim } from "@/components/brand-mark";
import { IconButton } from "@/components/ui/icon-button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  GridIcon,
  DocIcon,
  ChartBarIcon,
  CreditCardIcon,
  InboxIcon,
  SettingsIcon,
  ExternalLinkIcon,
  MenuIcon,
  CloseIcon,
} from "@/components/ui/icons";

type IconType = typeof GridIcon;

const NAV: { href: string; key: MessageKey; icon: IconType; badge?: boolean }[] = [
  { href: "/admin", key: "admin.nav.overview", icon: GridIcon },
  { href: "/admin/articles", key: "admin.nav.articles", icon: DocIcon },
  { href: "/admin/stats", key: "admin.nav.stats", icon: ChartBarIcon },
  { href: "/admin/plan", key: "admin.nav.plan", icon: CreditCardIcon },
  { href: "/admin/inbox", key: "admin.nav.inbox", icon: InboxIcon, badge: true },
  { href: "/admin/settings", key: "admin.nav.settings", icon: SettingsIcon },
];

export interface AdminShellProps {
  locale: Locale;
  tenantName: string;
  logoUrl: string | null;
  /** Operator-Instanz → Logo mit Claim statt Initial+Name (wie HelpShell). */
  isOperator?: boolean;
  /** Angemeldetes Team-Mitglied (Layout-Gate garantiert eine Session). */
  viewer?: HelpViewer | null;
  children: ReactNode;
}

export function AdminShell({
  locale,
  tenantName,
  logoUrl,
  isOperator = false,
  viewer = null,
  children,
}: AdminShellProps) {
  const t = getT(locale);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Ticket-Badge kommt mit dem echten Support-Flow zurück (keine Fake-Zähler).
  const openTickets = 0;

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3" aria-label={t("admin.nav.overview")}>
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-comfy px-3 py-2 text-sm transition-colors",
              active
                ? "bg-tint font-medium text-ink"
                : "text-ink-muted hover:bg-tint hover:text-ink",
            )}
          >
            <Icon width={17} height={17} className="shrink-0" />
            <span className="flex-1">{t(item.key)}</span>
            {item.badge && openTickets > 0 ? (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-xs font-medium text-brand-fg">
                {openTickets}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="flex items-center gap-3 px-4 py-3">
          <IconButton
            aria-label={t("hc.openMenu")}
            onClick={() => setOpen(true)}
            className="h-9 w-9 shadow-none md:hidden"
          >
            <MenuIcon width={18} height={18} />
          </IconButton>
          {/* Operator: Logo mit Claim ersetzt Initial+Schriftzug (wie HelpShell). */}
          <div className="flex items-center gap-2.5">
            {isOperator && !logoUrl ? (
              <LogoWithClaim alt={tenantName} className="h-8 w-auto" />
            ) : (
              <>
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt={tenantName} className="h-7 w-auto" />
                ) : (
                  <span className="grid h-8 w-8 place-items-center rounded-comfy bg-brand text-sm font-semibold text-brand-fg">
                    {tenantName.charAt(0)}
                  </span>
                )}
                <span className="font-semibold tracking-[-0.3px]">{tenantName}</span>
              </>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Link
              href="/help"
              className="inline-flex items-center gap-1.5 rounded-std border border-hairline bg-surface px-3 py-1.5 text-sm text-ink transition-colors hover:bg-tint"
            >
              <ExternalLinkIcon width={15} height={15} />
              <span className="hidden sm:inline">{t("admin.viewHelpCenter")}</span>
            </Link>
            <ThemeToggle label={t("hc.themeToggle")} />
            {/* Konto — dasselbe Menü wie im Hilfezentrum (account-menu.tsx);
                Admin-Link aus, wir sind bereits hier. */}
            <AccountMenu
              locale={locale}
              viewer={viewer}
              isOperator={isOperator}
              showAdminLink={false}
            />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-hairline md:block">
          <div className="sticky top-[61px]">{nav}</div>
        </aside>

        {open ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] overflow-y-auto border-r border-hairline bg-surface">
              <div className="flex justify-end p-2">
                <IconButton
                  aria-label={t("hc.closeMenu")}
                  onClick={() => setOpen(false)}
                  className="h-9 w-9 shadow-none"
                >
                  <CloseIcon width={18} height={18} />
                </IconButton>
              </div>
              {nav}
            </div>
          </div>
        ) : null}

        <main className="min-w-0 flex-1 px-5 py-8 md:px-8 lg:px-10">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Einheitlicher Seitenkopf für Admin-Unterseiten. */
export function AdminPageHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.5px]">{title}</h1>
        {subtitle ? <p className="mt-1 text-ink-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
