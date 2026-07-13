"use client";

import { useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { cn } from "@/lib/ui/cn";
import { fakeAdmin } from "@/lib/admin/fake-admin";
import { TICKET_STATUS } from "@/components/admin/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

export function InboxView({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const tickets = fakeAdmin.tickets();
  const [selectedId, setSelectedId] = useState(tickets[0]?.id ?? null);
  const selected = tickets.find((tk) => tk.id === selectedId) ?? null;

  return (
    <div className="grid gap-6 md:grid-cols-[320px_1fr]">
      <aside className="overflow-hidden rounded-card border border-hairline bg-surface">
        <ul className="divide-y divide-hairline">
          {tickets.map((tk) => (
            <li key={tk.id}>
              <button
                onClick={() => setSelectedId(tk.id)}
                aria-current={selectedId === tk.id}
                className={cn(
                  "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
                  selectedId === tk.id ? "bg-tint" : "hover:bg-tint",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                    {tk.subject}
                  </span>
                  <Badge tone={TICKET_STATUS[tk.status].tone} dot>
                    {t(TICKET_STATUS[tk.status].key)}
                  </Badge>
                </span>
                <span className="truncate text-xs text-ink-muted">
                  {tk.from} · {tk.timeLabel}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="rounded-card border border-hairline bg-surface p-6">
        {selected ? (
          <div>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.3px]">{selected.subject}</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  {t("admin.inbox.from")}: {selected.from} · {selected.timeLabel}
                </p>
              </div>
              <Badge tone={TICKET_STATUS[selected.status].tone} dot>
                {t(TICKET_STATUS[selected.status].key)}
              </Badge>
            </div>
            <div className="flex flex-col gap-3 border-t border-hairline pt-4 text-[15px] leading-relaxed text-ink">
              {selected.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <div className="mt-6">
              <Textarea label={t("admin.inbox.reply")} placeholder="…" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" size="sm">
                  {t("admin.inbox.reply")}
                </Button>
                <Button variant="ghost" size="sm">
                  {t("admin.inbox.resolve")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{t("admin.inbox.empty")}</p>
        )}
      </section>
    </div>
  );
}
