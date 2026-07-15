import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { InboxIcon } from "@/components/ui/icons";

/**
 * Support-Inbox — EHRLICHER Leerzustand (Regel „keine Mockdaten", 2026-07-15):
 * Der Support-Flow („Etwas stimmt nicht?" → KI-Triage → Ticket) ist eine
 * spätere Phase; bis dahin gibt es hier schlicht keine Tickets. Die Ticket-
 * Liste + Antwort-UI kommen mit dem echten Flow zurück (Register: Support-Flow-Ende).
 */
export function InboxView({ locale }: { locale: Locale }) {
  const t = getT(locale);
  return (
    <section className="grid place-items-center rounded-card border border-hairline bg-surface px-6 py-16 text-center">
      <InboxIcon width={28} height={28} className="text-ink-muted" />
      <p className="mt-3 text-sm font-medium text-ink">{t("admin.inbox.none")}</p>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{t("admin.inbox.noneHint")}</p>
    </section>
  );
}
