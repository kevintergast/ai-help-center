import type { ArticleStatus } from "@/lib/content/types";
import type { MessageKey } from "@/i18n/messages/de";

type Tone = "ok" | "warn" | "brand" | "neutral";

/** Artikel-Aktualitätsstatus → Badge-Ton + i18n-Key (wiederverwendet aus dem Hilfezentrum). */
export const ARTICLE_STATUS: Record<ArticleStatus, { tone: Tone; key: MessageKey }> = {
  current: { tone: "ok", key: "hc.status.current" },
  stale: { tone: "warn", key: "hc.status.stale" },
  ai: { tone: "brand", key: "hc.status.ai" },
  draft: { tone: "neutral", key: "hc.status.draft" },
};

export const TICKET_STATUS: Record<
  "new" | "open" | "resolved",
  { tone: Tone; key: MessageKey }
> = {
  new: { tone: "brand", key: "admin.inbox.status.new" },
  open: { tone: "warn", key: "admin.inbox.status.open" },
  resolved: { tone: "ok", key: "admin.inbox.status.resolved" },
};
