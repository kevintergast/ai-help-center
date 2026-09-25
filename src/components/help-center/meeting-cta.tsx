import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { meetingHref, type MeetingLink } from "@/lib/content/meeting";
import { CalendarIcon, ExternalLinkIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * BUCHUNGS-AUFRUF (0048) — eine Darstellung für alle vier Platzierungen.
 *
 * Bewusst EINE Komponente: Artikelende, gescheiterte Hilfe, Kontaktseite und
 * Startseite zeigen denselben Link mit demselben Versprechen. Vier eigene
 * Bauteile würden mit der Zeit vier verschieden formulierte Knöpfe ergeben,
 * und der Betreiber pflegt Überschrift und Beschriftung ja nur einmal.
 *
 * `context` reist als Notiz in die Buchung (cal.com füllt sie vor, andere
 * Dienste ignorieren den Parameter) — der Artikeltitel oder die Frage, an der
 * jemand hängengeblieben ist. Damit weiß der Berater vorher, worum es geht.
 *
 * `variant` unterscheidet nur die Umrandung: `card` steht als eigene Kachel
 * (Kontakt-/Startseite), `inline` als ruhiger Block im Lesefluss
 * (Artikelende, nach erfolgloser Hilfe).
 */
export function MeetingCta({
  locale,
  link,
  context = null,
  variant = "inline",
  className,
}: {
  locale: Locale;
  link: MeetingLink;
  context?: string | null;
  variant?: "inline" | "card";
  className?: string;
}) {
  const t = getT(locale);
  return (
    <a
      href={meetingHref(link, context)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${link.label} — ${t("hc.meeting.opensExternally")}`}
      className={cn(
        "flex flex-col gap-1 rounded-card border border-hairline bg-surface p-5 transition-colors hover:border-brand/40 hover:bg-tint",
        // `h-full` NUR im Kachel-Gitter: Dort sollen nebeneinander stehende
        // Karten gleich hoch sein. Im Lesefluss ist die Artikelspalte ein
        // Flex-Element mit fester Höhe — `height: 100%` ging dort gegen die
        // GANZE Spalte auf und blähte die Karte auf knapp 1000 Pixel, mit
        // einem entsprechend riesigen leeren Feld darin (gemeldet 2026-09-25).
        variant === "card" ? "h-full" : "bg-surface-raised",
        className,
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        <CalendarIcon width={16} height={16} className="shrink-0 opacity-70" />
        {link.title}
      </span>
      {link.description.length > 0 ? (
        <span className="text-[13px] leading-snug text-ink-muted">{link.description}</span>
      ) : null}
      <span className="mt-2 inline-flex items-center gap-1.5 self-start rounded-std bg-brand px-2.5 py-1.5 text-sm text-brand-fg">
        {link.label}
        <ExternalLinkIcon width={13} height={13} aria-hidden />
      </span>
    </a>
  );
}
