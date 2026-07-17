"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InboxIcon } from "@/components/ui/icons";

/**
 * SUPPORT-INBOX (echt, Support-Flow 2026-07-17): Tickets aus „Etwas stimmt
 * nicht?" — offene zuerst. Erledigen/Wiedereröffnen/Löschen über die
 * admin-gegatete API; die Inbox ist der verlustfreie Fallback zur Ticket-Mail
 * (tenants.support_email). Ersetzt den früheren Leerzustand-Platzhalter.
 */

interface Ticket {
  id: string;
  message: string;
  contactEmail: string | null;
  question: string | null;
  status: "open" | "done";
  createdAt: number;
}

export function InboxView({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState(false);
  const df = new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v1/admin/support", {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(String(res.status));
        setTickets(((await res.json()) as { tickets: Ticket[] }).tickets);
      } catch {
        setError(true);
      }
    })();
  }, []);

  async function update(id: string, action: "done" | "open" | "delete") {
    const prev = tickets;
    // Optimistisch; bei Fehler zurückrollen.
    setTickets(
      (cur) =>
        cur &&
        (action === "delete"
          ? cur.filter((x) => x.id !== id)
          : cur.map((x) => (x.id === id ? { ...x, status: action } : x))),
    );
    try {
      const res = await fetch(`/api/v1/admin/support/${id}`, {
        method: action === "delete" ? "DELETE" : "PATCH",
        headers: { "content-type": "application/json" },
        ...(action !== "delete" ? { body: JSON.stringify({ status: action }) } : {}),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setTickets(prev);
      setError(true);
    }
  }

  if (error) {
    return (
      <section className="rounded-card border border-hairline bg-surface px-6 py-10 text-center text-sm text-crit">
        {t("admin.inbox.error")}
      </section>
    );
  }
  if (tickets === null) {
    return (
      <section className="rounded-card border border-hairline bg-surface px-6 py-10 text-center text-sm text-ink-muted">
        {t("admin.inbox.loading")}
      </section>
    );
  }
  if (tickets.length === 0) {
    return (
      <section className="grid place-items-center rounded-card border border-hairline bg-surface px-6 py-16 text-center">
        <InboxIcon width={28} height={28} className="text-ink-muted" />
        <p className="mt-3 text-sm font-medium text-ink">{t("admin.inbox.none")}</p>
        <p className="mt-1 max-w-md text-sm text-ink-muted">{t("admin.inbox.noneHint")}</p>
      </section>
    );
  }

  const openCount = tickets.filter((x) => x.status === "open").length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        {t("admin.inbox.openCount", { n: String(openCount) })}
      </p>
      <ul className="flex flex-col gap-3">
        {tickets.map((ticket) => (
          <li
            key={ticket.id}
            className="rounded-card border border-hairline bg-surface p-4 sm:p-5"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone={ticket.status === "open" ? "warn" : "ok"} dot>
                {ticket.status === "open" ? t("admin.inbox.open") : t("admin.inbox.doneLabel")}
              </Badge>
              <span className="text-xs text-ink-muted">
                {df.format(new Date(ticket.createdAt * 1000))}
              </span>
              <span className="text-xs text-ink-muted">
                {ticket.contactEmail
                  ? t("admin.inbox.contact", { email: ticket.contactEmail })
                  : t("admin.inbox.anonymous")}
              </span>
            </div>
            {ticket.question ? (
              <p className="mb-1.5 text-xs text-ink-muted">
                {t("admin.inbox.question", { q: ticket.question })}
              </p>
            ) : null}
            <p className="whitespace-pre-wrap text-sm text-ink">{ticket.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {ticket.status === "open" ? (
                <Button size="sm" onClick={() => void update(ticket.id, "done")}>
                  {t("admin.inbox.markDone")}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => void update(ticket.id, "open")}>
                  {t("admin.inbox.reopen")}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void update(ticket.id, "delete")}>
                {t("admin.inbox.delete")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
