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
  helpfulPct: number;
  usedIn: number;
  updatedLabel: string;
}
