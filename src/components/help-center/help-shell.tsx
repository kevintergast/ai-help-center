"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HelpViewer } from "@/lib/auth/viewer";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import type { HelpCenterData } from "@/lib/content/types";
import { OPEN_ANSWER_KEY } from "@/lib/content/handoff";
import {
  listSaved,
  SAVED_CHANGED_EVENT,
  type SavedArticle,
} from "@/lib/content/saved-articles";
import { cn } from "@/lib/ui/cn";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { SearchCombobox } from "@/components/ui/search-combobox";
import { Accordion } from "@/components/ui/accordion";
import { AccountMenu } from "@/components/account-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Emblem, LogoWithClaim } from "@/components/brand-mark";
import {
  ArrowLeftIcon,
  BookmarkIcon,
  CloseIcon,
  DocIcon,
  MegaphoneIcon,
  MenuIcon,
  PlusIcon,
  RoadmapIcon,
} from "@/components/ui/icons";

type T = ReturnType<typeof getT>;

const NAV_ROW =
  "flex w-full items-center gap-2 rounded-comfy px-2 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-tint hover:text-ink";

export interface HelpShellProps {
  locale: Locale;
  tenantName: string;
  logoUrl: string | null;
  /** Dark-Mode-Logo (0023) — null: Dark Mode zeigt das helle. */
  logoDarkUrl?: string | null;
  data: HelpCenterData;
  /** Slug des aktuell offenen Artikels (Navigation hervorheben). */
  activeSlug?: string;
  /** Operator-Instanz (app.*) → CTA „Eigenes Hilfezentrum erstellen" im Header. */
  isOperator?: boolean;
  /**
   * Angemeldeter Betrachter (serverseitig via readPageViewer gelesen) →
   * Konto-Popup mit Identität, rollenbasierten Links und Abmelden.
   * `null`/fehlend = anonym → Anmelden-Hinweis.
   */
  viewer?: HelpViewer | null;
  /** Optionaler Klick aufs Logo (sonst Navigation nach `/`). */
  onHome?: () => void;
  /** Gespeicherte Antwort direkt öffnen (Startansicht); ohne → Handoff + Navigation nach `/`. */
  onOpenSavedAnswer?: (s: SavedArticle) => void;
  /** Inhalt der unteren Eingabe-Leiste (Prompt); ohne → keine Leiste. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Rahmen des Endnutzer-Hilfezentrums: volle Breite, App-Shell-Scroll (Header +
 * Navigation immer sichtbar, nur der Inhalt scrollt). Wird von der Startansicht
 * UND der Artikelseite genutzt. Roadmap/Changelog öffnen als „Ebene tiefer":
 * die Navigation zeigt dann nur Zurück + Titel, der Inhalt die jeweilige Liste.
 */
export function HelpShell({
  locale,
  tenantName,
  logoUrl,
  logoDarkUrl = null,
  data,
  activeSlug,
  isOperator = false,
  viewer = null,
  onHome,
  onOpenSavedAnswer,
  footer,
  children,
}: HelpShellProps) {
  const t = getT(locale);
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drill, setDrill] = useState<null | "roadmap" | "changelog">(null);
  const [saved, setSaved] = useState<SavedArticle[]>([]);

  const searchItems = useMemo(
    () => data.searchItems.map((a) => ({ id: a.id, title: a.title, category: a.category })),
    [data.searchItems],
  );
  const slugById = useMemo(
    () => new Map(data.searchItems.map((a) => [a.id, a.slug])),
    [data.searchItems],
  );

  // „Meine Artikel"-Liste (localStorage) live halten — auch bei Änderungen im selben Tab.
  useEffect(() => {
    const refresh = () => setSaved(listSaved());
    refresh();
    window.addEventListener(SAVED_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SAVED_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  function openSlug(slug: string) {
    setSidebarOpen(false);
    router.push(`/${slug}`);
  }
  function openDrill(which: "roadmap" | "changelog") {
    setSidebarOpen(false);
    setDrill(which);
  }
  function openSavedItem(s: SavedArticle) {
    setSidebarOpen(false);
    if (onOpenSavedAnswer) {
      onOpenSavedAnswer(s);
      return;
    }
    try {
      sessionStorage.setItem(OPEN_ANSWER_KEY, s.id);
    } catch {
      /* ignore */
    }
    router.push("/");
  }

  const normalSidebar = (
    <div className="flex h-full flex-col gap-5 p-4">
      <SearchCombobox
        items={searchItems}
        placeholder={t("hc.searchPlaceholder")}
        emptyLabel={t("hc.searchEmpty")}
        aria-label={t("hc.searchAria")}
        onSelect={(it) => openSlug(slugById.get(it.id) ?? it.id)}
      />
      <nav aria-label={t("hc.articlesHeading")} className="flex flex-col gap-5 overflow-y-auto">
        {/* Ganz oben: Roadmap + Changelog (öffnen eine Ebene tiefer). */}
        <ul className="flex flex-col gap-0.5">
          <li>
            <button onClick={() => openDrill("roadmap")} className={NAV_ROW}>
              <RoadmapIcon width={15} height={15} className="shrink-0 opacity-70" />
              <span className="truncate">{t("hc.roadmap")}</span>
            </button>
          </li>
          <li>
            <button onClick={() => openDrill("changelog")} className={NAV_ROW}>
              <MegaphoneIcon width={15} height={15} className="shrink-0 opacity-70" />
              <span className="truncate">{t("hc.changelog")}</span>
            </button>
          </li>
        </ul>

        {/* Eigener Abschnitt „Meine Artikel" (gespeicherte KI-Antworten) + Anmelden/Avatar. */}
        <div>
          <p className="mb-1.5 px-2 text-xs uppercase tracking-[0.08em] text-ink-muted">
            {t("hc.myArticles")}
          </p>
          {saved.length === 0 ? (
            <p className="px-2 text-xs text-ink-muted">{t("hc.myArticlesEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {saved.map((s) => (
                <li key={s.id}>
                  <button onClick={() => openSavedItem(s)} className={NAV_ROW}>
                    <BookmarkIcon width={15} height={15} className="shrink-0 opacity-70" />
                    <span className="truncate">{s.question}</span>
                    {/* Staleness (Architektur): Quellen geändert → sichtbar markieren. */}
                    {s.stale ? (
                      <Badge tone="warn" className="ml-auto shrink-0">
                        {t("hc.stale.badge")}
                      </Badge>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

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

  // Drill-Down: nur Zurück + Titel, keine weiteren Navigationselemente.
  const drilledSidebar = (
    <div className="p-4">
      <button
        onClick={() => setDrill(null)}
        className="flex w-full items-center gap-2 rounded-comfy px-2 py-1.5 text-left text-sm font-medium text-ink transition-colors hover:bg-tint"
      >
        <ArrowLeftIcon width={16} height={16} className="shrink-0" />
        <span className="truncate">{drill === "roadmap" ? t("hc.roadmap") : t("hc.changelog")}</span>
      </button>
    </div>
  );

  const sidebar = drill ? drilledSidebar : normalSidebar;

  // Operator-Instanz: volles Logo mit Claim ERSETZT Emblem + Schriftzug
  // (User-Vorgabe 2026-07-15). Kunden-Tenants (White-Label) unverändert:
  // eigenes Logo bzw. Initial-Kachel, jeweils mit Namens-Schriftzug.
  const logo =
    isOperator && !logoUrl ? (
      <LogoWithClaim alt={tenantName} className="h-9 w-auto" />
    ) : (
      <>
        {logoUrl ? (
          <picture>
            {logoDarkUrl ? <source srcSet={logoDarkUrl} media="(prefers-color-scheme: dark)" /> : null}
            { }
            <img src={logoUrl} alt={tenantName} className="h-7 w-auto" />
          </picture>
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
            onClick={() => {
              setDrill(null);
              onHome();
            }}
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
          {/* Konto — gemeinsames Menü mit dem Admin-Header (account-menu.tsx). */}
          <AccountMenu locale={locale} viewer={viewer} isOperator={isOperator} />
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
          <div className="flex-1 overflow-y-auto">
            {drill === "roadmap" ? (
              <div className="px-5 py-8 md:px-10">
                <RoadmapView t={t} items={data.roadmap} />
              </div>
            ) : drill === "changelog" ? (
              <div className="px-5 py-8 md:px-10">
                <ChangelogView t={t} entries={data.changelog} />
              </div>
            ) : (
              children
            )}
          </div>
          {!drill && footer ? (
            <div className="border-t border-hairline bg-surface px-4 py-3">{footer}</div>
          ) : null}
          <LegalFooter t={t} />
        </main>
      </div>
    </div>
  );
}

/** Schmale Legal-Zeile am unteren Rand (links): Emblem (schwarz/weiß je Theme) + Rechtslinks. */
function LegalFooter({ t }: { t: T }) {
  return (
    <div className="flex items-center gap-3 border-t border-hairline bg-surface px-5 py-2 md:px-10">
      <Emblem className="h-4 w-4 shrink-0 text-ink" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        <Link href="/legal/impressum" className="transition-colors hover:text-ink">
          {t("hc.legal.imprint")}
        </Link>
        <Link href="/legal/datenschutz" className="transition-colors hover:text-ink">
          {t("hc.legal.privacy")}
        </Link>
        <Link href="/legal/agb" className="transition-colors hover:text-ink">
          {t("hc.legal.terms")}
        </Link>
      </div>
    </div>
  );
}

/* ————— Drill-Down-Ansichten ————— */

function RoadmapView({ t, items }: { t: T; items: HelpCenterData["roadmap"] }) {
  const order = ["in_progress", "planned", "shipped"] as const;
  const groups = order
    .map((st) => ({ st, entries: items.filter((r) => r.status === st) }))
    .filter((g) => g.entries.length > 0);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-[26px] font-semibold tracking-[-0.5px]">{t("hc.roadmapTitle")}</h1>
      <Accordion
        items={groups.map((g) => ({
          id: g.st,
          question: (
            <span className="flex items-center gap-2">
              {t(`hc.roadmap.${g.st}` as MessageKey)}
              <span className="text-xs font-normal text-ink-muted">{g.entries.length}</span>
            </span>
          ),
          answer: (
            <ul className="flex flex-col gap-2">
              {g.entries.map((it) => (
                <li key={it.id} className="flex items-center gap-2 text-ink">
                  <RoadmapIcon width={15} height={15} className="shrink-0 text-ink-muted" />
                  {it.title}
                </li>
              ))}
            </ul>
          ),
        }))}
      />
    </div>
  );
}

function ChangelogView({ t, entries }: { t: T; entries: HelpCenterData["changelog"] }) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-[26px] font-semibold tracking-[-0.5px]">{t("hc.changelogTitle")}</h1>
        <Badge tone="brand">{t("hc.changelogVersion", { v: "1.0.0" })}</Badge>
      </div>
      <ul className="flex flex-col gap-5">
        {entries.map((c) => (
          <li key={c.id} className="border-l-2 border-hairline pl-4">
            <div className="text-xs text-ink-muted">{c.dateLabel}</div>
            <div className="font-semibold text-ink">{c.title}</div>
            <div className="mt-0.5 text-sm text-ink-muted">{c.description}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
