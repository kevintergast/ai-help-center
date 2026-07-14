"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import type { HelpCenterData } from "@/lib/content/types";
import { OPEN_SAVED_KEY } from "@/lib/content/handoff";
import { cn } from "@/lib/ui/cn";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { SearchCombobox } from "@/components/ui/search-combobox";
import { Dialog } from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandMark } from "@/components/brand-mark";
import {
  BookmarkIcon,
  CloseIcon,
  DocIcon,
  MegaphoneIcon,
  MenuIcon,
  PlusIcon,
  RoadmapIcon,
  UserIcon,
} from "@/components/ui/icons";

export interface HelpShellProps {
  locale: Locale;
  tenantName: string;
  logoUrl: string | null;
  data: HelpCenterData;
  /** Slug des aktuell offenen Artikels (Navigation hervorheben). */
  activeSlug?: string;
  /** Operator-Instanz (app.*) → CTA „Eigenes Hilfezentrum erstellen" im Header. */
  isOperator?: boolean;
  /** Optionaler Klick aufs Logo (sonst Navigation nach `/`). */
  onHome?: () => void;
  /** Direktes Öffnen der Gespeichert-Liste (Startansicht); ohne → Handoff + Navigation nach `/`. */
  onOpenSaved?: () => void;
  /** Inhalt der unteren Eingabe-Leiste (Prompt); ohne → keine Leiste. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Rahmen des Endnutzer-Hilfezentrums: volle Breite, App-Shell-Scroll (Header +
 * Navigation immer sichtbar, nur der Inhalt scrollt). Wird von der Startansicht
 * UND der Artikelseite genutzt, damit die Chrome konsistent bleibt.
 */
export function HelpShell({
  locale,
  tenantName,
  logoUrl,
  data,
  activeSlug,
  isOperator = false,
  onHome,
  onOpenSaved,
  footer,
  children,
}: HelpShellProps) {
  const t = getT(locale);
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dialog, setDialog] = useState<"roadmap" | "changelog" | null>(null);

  const searchItems = useMemo(
    () => data.searchItems.map((a) => ({ id: a.id, title: a.title, category: a.category })),
    [data.searchItems],
  );
  const slugById = useMemo(
    () => new Map(data.searchItems.map((a) => [a.id, a.slug])),
    [data.searchItems],
  );

  function openSlug(slug: string) {
    setSidebarOpen(false);
    router.push(`/${slug}`);
  }

  const sidebar = (
    <div className="flex h-full flex-col gap-5 p-4">
      <SearchCombobox
        items={searchItems}
        placeholder={t("hc.searchPlaceholder")}
        emptyLabel={t("hc.searchEmpty")}
        aria-label={t("hc.searchAria")}
        onSelect={(it) => openSlug(slugById.get(it.id) ?? it.id)}
      />
      <nav aria-label={t("hc.articlesHeading")} className="flex flex-col gap-5 overflow-y-auto">
        {/* Standard-Navigation ganz oben: Roadmap + Changelog (öffnen Dialoge). */}
        <ul className="flex flex-col gap-0.5">
          <li>
            <button
              onClick={() => {
                setSidebarOpen(false);
                setDialog("roadmap");
              }}
              className="flex w-full items-center gap-2 rounded-comfy px-2 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-tint hover:text-ink"
            >
              <RoadmapIcon width={15} height={15} className="shrink-0 opacity-70" />
              <span className="truncate">{t("hc.roadmap")}</span>
            </button>
          </li>
          <li>
            <button
              onClick={() => {
                setSidebarOpen(false);
                setDialog("changelog");
              }}
              className="flex w-full items-center gap-2 rounded-comfy px-2 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-tint hover:text-ink"
            >
              <MegaphoneIcon width={15} height={15} className="shrink-0 opacity-70" />
              <span className="truncate">{t("hc.changelog")}</span>
            </button>
          </li>
          <li>
            <button
              onClick={() => {
                setSidebarOpen(false);
                if (onOpenSaved) {
                  onOpenSaved();
                  return;
                }
                try {
                  sessionStorage.setItem(OPEN_SAVED_KEY, "1");
                } catch {
                  /* ignore */
                }
                router.push("/");
              }}
              className="flex w-full items-center gap-2 rounded-comfy px-2 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-tint hover:text-ink"
            >
              <BookmarkIcon width={15} height={15} className="shrink-0 opacity-70" />
              <span className="truncate">{t("hc.savedArticles")}</span>
            </button>
          </li>
        </ul>
        {data.groups.map((g) => (
          <div key={g.category}>
            <p className="mb-1.5 px-2 text-xs uppercase tracking-[0.08em] text-ink-muted">
              {g.category}
            </p>
            <ul className="flex flex-col gap-0.5">
              {g.articles.map((a) => {
                const active = a.slug === activeSlug;
                return (
                  <li key={a.id}>
                    <Link
                      href={`/${a.slug}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-comfy px-2 py-1.5 text-left text-sm transition-colors",
                        active
                          ? "bg-tint font-medium text-ink"
                          : "text-ink-muted hover:bg-tint hover:text-ink",
                      )}
                    >
                      <DocIcon width={15} height={15} className="shrink-0 opacity-70" />
                      <span className="truncate">{a.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );

  const logo = (
    <>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={tenantName} className="h-7 w-auto" />
      ) : isOperator ? (
        // Plattform-/Operator-Instanz ohne Custom-Logo → HallOfHelp-Bildmarke.
        <BrandMark className="h-8 w-8" />
      ) : (
        <span className="grid h-8 w-8 place-items-center rounded-comfy bg-brand text-sm font-semibold text-brand-fg">
          {tenantName.charAt(0)}
        </span>
      )}
      <span className="font-semibold tracking-[-0.3px]">{tenantName}</span>
    </>
  );

  return (
    <div className="flex h-screen flex-col bg-surface text-ink">
      {/* Top bar (immer sichtbar) */}
      <header className="z-30 flex w-full items-center gap-3 border-b border-hairline bg-surface px-4 py-3">
        <IconButton
          aria-label={t("hc.openMenu")}
          onClick={() => setSidebarOpen(true)}
          className="h-9 w-9 shadow-none md:hidden"
        >
          <MenuIcon width={18} height={18} />
        </IconButton>
        {onHome ? (
          <button
            onClick={onHome}
            aria-label={t("hc.home")}
            className="flex items-center gap-2.5 rounded-std focus-visible:outline-none focus-visible:shadow-focusglow"
          >
            {logo}
          </button>
        ) : (
          <Link
            href="/"
            aria-label={t("hc.home")}
            className="flex items-center gap-2.5 rounded-std focus-visible:outline-none focus-visible:shadow-focusglow"
          >
            {logo}
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isOperator ? (
            <Link
              href="/console"
              className="inline-flex items-center gap-2 rounded-std bg-[var(--btn-primary-bg)] px-3 py-1.5 text-sm text-[var(--btn-primary-fg)] shadow-inset transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:shadow-focusglow"
            >
              <PlusIcon width={15} height={15} />
              <span className="hidden sm:inline">{t("hc.createHelpCenter")}</span>
            </Link>
          ) : null}
          <ThemeToggle label={t("hc.themeToggle")} />
          {/* Profil/Konto — auf jeder Instanz. Ohne Session: Einstieg in Login/Registrierung. */}
          <Link
            href="/login"
            aria-label={t("hc.account")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-hairline bg-surface-raised text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:shadow-focusglow"
          >
            <UserIcon width={18} height={18} />
          </Link>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (immer sichtbar) */}
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-hairline md:block">
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        {sidebarOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} aria-hidden />
            <div className="absolute inset-y-0 left-0 w-80 max-w-[85%] overflow-y-auto border-r border-hairline bg-surface">
              <div className="flex justify-end p-2">
                <IconButton
                  aria-label={t("hc.closeMenu")}
                  onClick={() => setSidebarOpen(false)}
                  className="h-9 w-9 shadow-none"
                >
                  <CloseIcon width={18} height={18} />
                </IconButton>
              </div>
              {sidebar}
            </div>
          </div>
        ) : null}

        {/* Main — volle Breite; nur der Inhalt scrollt */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">{children}</div>
          {footer ? (
            <div className="border-t border-hairline bg-surface px-4 py-3">{footer}</div>
          ) : null}
        </main>
      </div>

      <Dialog
        open={dialog === "roadmap"}
        onClose={() => setDialog(null)}
        title={t("hc.roadmapTitle")}
        closeLabel={t("hc.close")}
      >
        <ul className="flex flex-col gap-3">
          {data.roadmap.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-3">
              <span className="text-ink">{it.title}</span>
              <Badge tone={it.status === "shipped" ? "ok" : it.status === "in_progress" ? "brand" : "neutral"}>
                {t(`hc.roadmap.${it.status}` as MessageKey)}
              </Badge>
            </li>
          ))}
        </ul>
      </Dialog>

      <Dialog
        open={dialog === "changelog"}
        onClose={() => setDialog(null)}
        title={t("hc.changelogTitle")}
        closeLabel={t("hc.close")}
      >
        <ul className="flex flex-col gap-4">
          {data.changelog.map((c) => (
            <li key={c.id}>
              <div className="text-xs text-ink-muted">{c.dateLabel}</div>
              <div className="font-medium text-ink">{c.title}</div>
              <div className="text-sm text-ink-muted">{c.description}</div>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
