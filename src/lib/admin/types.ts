import type { ArticleStatus } from "@/lib/content/types";

/**
 * Zeilen-Shape der Admin-Artikeltabelle (Anzeige-Status inkl. „ai"/„stale",
 * siehe displayStatus in server/content/store.ts). Ehemals Teil der
 * Fake-Datenschicht — die ist mit dem echten Metering (Infra-Plan Schritt 5)
 * entfallen; der Vertrag lebt jetzt hier.
 */
export interface AdminArticleRow {
  id: string;
  title: string;
  category: string;
  status: ArticleStatus;
  views: number;
  /** Hilfreich-Quote in % — `null` = noch kein Feedback (UI zeigt „—"). */
  helpfulPct: number | null;
  usedIn: number;
  updatedLabel: string;
  /** Sprache der Fassung (Translation-Sets werden in der Liste gruppiert). */
  locale: string;
  /** Set-Schlüssel: Fassungen mit gleichem Key gehören zusammen. */
  articleKey: string;
  /** unixepoch — Basis der Übersetzungs-Staleness (Original neuer = veraltet). */
  updatedAt: number;
}
