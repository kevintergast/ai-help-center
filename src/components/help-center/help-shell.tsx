"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { HelpDrillContext } from "./entry-cards";
import { ArticleIconGlyph } from "@/components/ui/article-icon";
import { ACTION_VARIANT_CLASSES, isExternalHref } from "@/lib/content/action-buttons";

/**
 * CHANGELOG-STUFEN (0030) für Endnutzer: Die technischen Wörter major/minor/patch
 * sagen Kunden nichts — angezeigt wird, was das Update FÜR SIE bedeutet.
 */
const LEVEL_KEYS: Record<"major" | "minor" | "patch", MessageKey> = {
  major: "hc.changelogLevel.major",
  minor: "hc.changelogLevel.minor",
  patch: "hc.changelogLevel.patch",
};
const LEVEL_TONES: Record<"major" | "minor" | "patch", "brand" | "ok" | "neutral"> = {
  major: "brand",
  minor: "ok",
  patch: "neutral",
};
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
  CodeIcon,
  ExternalLinkIcon,
  InboxIcon,
  MegaphoneIcon,
  MenuIcon,
  PlusIcon,
  RoadmapIcon,
} from "@/components/ui/icons";

type T = ReturnType<typeof getT>;

const NAV_ROW =
  "flex w-full items-center gap-2 rounded-comfy px-2 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink";

export interface HelpShellProps {
  locale: Locale;
  tenantName: string;
  logoUrl: string | null;
  /** Dark-Mode-Logo (0023) — null: Dark Mode zeigt das helle. */
  logoDarkUrl?: string | null;
  /** Favicon (0031) — das quadratische Zeichen im Fuß. */
  faviconUrl?: string | null;
  /** Instanzname neben dem Logo (0025) — false nur wirksam MIT Logo. */
  showName?: boolean;
  data: HelpCenterData;
  /** Slug des aktuell offenen Artikels (Navigation hervorheben). */
  activeSlug?: string;
  /** Die Kontaktseite ist offen → ihren Eintrag unten hervorheben. */
  activeContact?: boolean;
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
  faviconUrl = null,
  showName = true,
  data,
  activeSlug,
  activeContact = false,
  isOperator = false,
  viewer = null,
  onHome,
  onOpenSavedAnswer,
  footer,
  children,
}: HelpShellProps) {
  const t = getT(locale);
  const router = useRouter();
  const searchParams = useSearchParams();
  const findQuery = searchParams.get("q") ?? "";
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

  // Einmal für die ganze Leiste: Hat überhaupt ein Artikel ein Symbol? Wenn
  // nicht (der Standard), fällt die Symbol-Spalte komplett weg — 15px, die
  // sonst auf jeder Zeile leer stünden.
  const anyIcon = data.groups.some((g) => g.articles.some((a) => a.icon));

  const normalSidebar = (
    <div className="flex h-full flex-col gap-5 overflow-visible p-4">
      {/* Sucht über Titel UND Inhalt — die Treffer tragen ihren eigenen Slug,
          ein Nachschlagen über die Id entfällt. */}
      <SearchCombobox
        articles={data.articles}
        initialQuery={findQuery}
        placeholder={t("hc.searchPlaceholder")}
        emptyLabel={t("hc.searchEmpty")}
        aria-label={t("hc.searchAria")}
        clearLabel={t("hc.searchClear")}
        // Die Anfrage reist mit: Im Artikel markiert sie die Fundstellen.
        onSelect={(hit, q) => openSlug(q.trim() ? `${hit.slug}?q=${encodeURIComponent(q.trim())}` : hit.slug)}
      />
      <nav aria-label={t("hc.articlesHeading")} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
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
                        // Aktiv/Hover = WEISSE Pille auf grauer Leiste. Auf der
                        // alten Einheitsfläche musste das ein Grauton sein und
                        // war entsprechend schwer zu sehen.
                        active
                          ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.06)]"
                          : "text-ink-muted hover:bg-surface hover:text-ink",
                      )}
                    >
                      {/* Symbol (0036): nur wenn eines gewählt ist. Die Spalte
                          wird aber freigehalten, SOBALD irgendein Artikel eines
                          hat — sonst stünden die Titel einer Liste versetzt. */}
                      {anyIcon ? (
                        <span className="flex w-[15px] shrink-0 justify-center opacity-70">
                          <ArticleIconGlyph name={a.icon} />
                        </span>
                      ) : null}
                      <span className="truncate">{a.title}</span>
                      {/* Artikel-Flag (0024) — hier sichtbar, damit „Beta" schon
                          VOR dem Klick erkennbar ist, nicht erst im Artikel. */}
                      {a.flag ? (
                        <Badge
                          tone={a.flag.color}
                          className="ml-auto shrink-0 px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                        >
                          {a.flag.text}
                        </Badge>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* KONTAKT (0037) ganz unten: der letzte Ausweg gehört ans Ende des
            Weges, nicht neben die Artikel. Erscheint NUR, wenn mindestens ein
            Weg gepflegt ist — ohne Wege gibt es die Seite gar nicht. */}
        {data.contactMethods.length > 0 ? (
          <div className="mt-auto border-t border-hairline pt-4">
            <Link
              href="/contact"
              aria-current={activeContact ? "page" : undefined}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex w-full items-center gap-2 rounded-comfy px-2 py-1.5 text-left text-sm transition-colors",
                activeContact
                  ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.06)]"
                  : "text-ink-muted hover:bg-surface hover:text-ink",
              )}
            >
              <InboxIcon width={15} height={15} className="shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{t("hc.contact.navLabel")}</span>
            </Link>
          </div>
        ) : null}
      </nav>
    </div>
  );

  // Drill-Down: nur Zurück + Titel, keine weiteren Navigationselemente.
  const drilledSidebar = (
    <div className="p-4">
      <button
        onClick={() => setDrill(null)}
        className="flex w-full items-center gap-2 rounded-comfy px-2 py-1.5 text-left text-sm font-medium text-ink transition-colors hover:bg-surface"
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
        {showName || !logoUrl ? (
          <span className="font-semibold tracking-[-0.3px]">{tenantName}</span>
        ) : null}
      </>
    );

  return (
    <div className="flex h-screen flex-col bg-page text-ink">
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
          {/* AKTIONS-KNÖPFE (0038) der Instanz — vor unseren eigenen
              Bedienelementen, weil sie die Handlung tragen, die dem Betreiber
              wichtig ist. Auf schmalen Schirmen bleibt nur das Symbol; ohne
              Symbol bleibt der Knopf sichtbar, denn ein Knopf ohne
              Beschriftung UND ohne Zeichen wäre eine leere Fläche. */}
          {data.headerActions.map((b) => {
            const external = isExternalHref(b.href);
            const cls = cn(
              "inline-flex items-center gap-1.5 rounded-std px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:shadow-focusglow",
              ACTION_VARIANT_CLASSES[b.variant],
            );
            const inner = (
              <>
                {b.icon ? <ArticleIconGlyph name={b.icon} size={15} /> : null}
                <span className={b.icon ? "hidden sm:inline" : undefined}>{b.label}</span>
                {external ? (
                  <ExternalLinkIcon width={11} height={11} className="shrink-0 opacity-60" aria-hidden />
                ) : null}
              </>
            );
            return external ? (
              <a key={b.id} href={b.href} target="_blank" rel="noopener noreferrer" className={cls}>
                {inner}
              </a>
            ) : (
              <Link key={b.id} href={b.href} className={cls}>
                {inner}
              </Link>
            );
          })}

          <ThemeToggle label={t("hc.themeToggle")} />
          {/* Konto — gemeinsames Menü mit dem Admin-Header (account-menu.tsx). */}
          <AccountMenu locale={locale} viewer={viewer} isOperator={isOperator} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (immer sichtbar) */}
        {/* Leiste bleibt auf dem App-Grund (grau); der Inhalt daneben ist weiß —
            die FLÄCHE trennt beide, nicht nur die Linie. */}
        {/* KEIN overflow hier: Die Trefferliste der Suche ist breiter als die
            Leiste und würde sonst abgeschnitten. Gescrollt wird innen von der
            <nav> (min-h-0 flex-1 overflow-y-auto) — die Leiste selbst braucht
            es nicht. */}
        <aside className="hidden w-72 shrink-0 border-r border-hairline bg-page md:block">
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        {sidebarOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} aria-hidden />
            <div className="absolute inset-y-0 left-0 w-80 max-w-[85%] overflow-y-auto border-r border-hairline bg-page">
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
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
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
              // Die Einstiegs-Karten der Startansicht müssen die Roadmap-/
              // Changelog-Ebene öffnen können — die lebt hier in der Hülle,
              // nicht in einer Route.
              <HelpDrillContext.Provider value={openDrill}>{children}</HelpDrillContext.Provider>
            )}
          </div>
          {!drill && footer ? (
            <div className="border-t border-hairline bg-surface px-4 py-3">{footer}</div>
          ) : null}
          <LegalFooter
            t={t}
            faviconUrl={faviconUrl}
            tenantName={tenantName}
            isOperator={isOperator === true}
          />
        </main>
      </div>
    </div>
  );
}

/**
 * Schmale Legal-Zeile am unteren Rand. Das Zeichen links war fest unser
 * Emblem — auf einer Kundeninstanz stand damit UNSER Logo im Fuß, obwohl das
 * ganze Produkt White-Label ist.
 *
 * Gezeigt wird das FAVICON des Mandanten, nicht sein Logo: Der Platz hier ist
 * ein 16-Punkt-Quadrat. Ein Logo ist breit und geht darin entweder unter oder
 * wird gequetscht; das Favicon ist genau für diese Größe gezeichnet.
 *
 * KEIN Rückfall aufs Logo: Das brächte genau das zurück, was hier stört. Ohne
 * Favicon bleibt die Zeile schlicht ohne Zeichen — die Rechtslinks tragen sie
 * auch allein. (Nur die Operator-Instanz zeigt unser Emblem; dort IST es das
 * Zeichen des Mandanten.)
 */
function LegalFooter({
  t,
  faviconUrl,
  tenantName,
  isOperator,
}: {
  t: T;
  faviconUrl: string | null;
  tenantName: string;
  isOperator: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-hairline bg-surface px-5 py-2 md:px-10">
      {faviconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={faviconUrl} alt={tenantName} className="h-4 w-4 shrink-0 rounded-[3px] object-contain" />
      ) : isOperator ? (
        <Emblem className="h-4 w-4 shrink-0 text-ink" />
      ) : null}
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
  const order = ["in_progress", "planned", "requested", "shipped"] as const;
  // Kein `as MessageKey`: Der annotierte Rückgabetyp lässt TypeScript prüfen,
  // dass es zu JEDEM Status einen Übersetzungstext gibt. Ein Cast hätte einen
  // fehlenden Text still als rohen Schlüssel gerendert.
  const statusKey = (st: (typeof order)[number]): MessageKey => `hc.roadmap.${st}`;
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
              {t(statusKey(g.st))}
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
  const latestVersion = entries.find((c) => (c.version ?? "").length > 0)?.version ?? null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-[26px] font-semibold tracking-[-0.5px]">{t("hc.changelogTitle")}</h1>
        {/* Aktuelle Version = die des neuesten Eintrags MIT Versionsnummer
            (0030). Vorher stand hier eine hartkodierte „1.0.0" — eine
            Attrappe. Pflegt eine Instanz keine Versionen, bleibt es leer. */}
        {latestVersion ? (
          <Badge tone="brand">{t("hc.changelogVersion", { v: latestVersion })}</Badge>
        ) : null}
      </div>
      <ul className="flex flex-col gap-5">
        {entries.map((c) => (
          <li key={c.id} className="border-l-2 border-hairline pl-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-muted">{c.dateLabel}</span>
              {c.version ? (
                <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[11px] text-ink-muted">
                  {c.version}
                </span>
              ) : null}
              {c.level ? <Badge tone={LEVEL_TONES[c.level]}>{t(LEVEL_KEYS[c.level])}</Badge> : null}
            </div>
            <div className="mt-1 font-semibold text-ink">{c.title}</div>
            <div className="mt-0.5 text-sm text-ink-muted">{c.description}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
