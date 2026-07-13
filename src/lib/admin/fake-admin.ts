import type { ArticleStatus } from "@/lib/content/types";

/*
  Fake-Datenschicht fürs Admin-Dashboard (rein für die UI; später aus D1/Analytics).
  Zahlen/Inhalte sind Beispieldaten — keine UI-Strings, daher nicht im i18n-Katalog.
*/

export interface Kpi {
  id: string;
  /** Vorformatierter Anzeigewert, z. B. "1,2k" oder "89 %". */
  value: string;
  /** Veränderung ggü. Vorwoche in Prozentpunkten/Prozent; Vorzeichen steuert Farbe. */
  deltaPct: number;
  /** Mini-Serie für Sparkline. */
  spark: number[];
}

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

export type TicketStatus = "new" | "open" | "resolved";

export interface Ticket {
  id: string;
  subject: string;
  from: string;
  timeLabel: string;
  status: TicketStatus;
  excerpt: string;
  body: string[];
}

export interface Invoice {
  id: string;
  dateLabel: string;
  amount: string;
  number: string;
}

export interface PlanOption {
  id: string;
  name: string;
  price: string;
  includedLabel: string;
  current: boolean;
}

export interface TopQuestion {
  id: string;
  text: string;
  count: number;
  grounded: boolean;
}

const KPIS: Kpi[] = [
  { id: "questions", value: "1.284", deltaPct: 12, spark: [8, 11, 9, 14, 13, 17, 16, 19, 18, 22, 21, 24, 23, 27] },
  { id: "grounded", value: "89 %", deltaPct: 3, spark: [82, 84, 83, 85, 86, 88, 89] },
  { id: "articles", value: "42", deltaPct: 5, spark: [36, 37, 38, 39, 40, 41, 42] },
  { id: "stale", value: "7", deltaPct: -2, spark: [10, 9, 9, 8, 8, 7, 7] },
];

const ARTICLES: AdminArticleRow[] = [
  { id: "start-account", title: "Konto einrichten", category: "Erste Schritte", status: "current", views: 1284, helpfulPct: 94, usedIn: 210, updatedLabel: "vor 3 Tagen" },
  { id: "integration-widget", title: "Widget einbinden", category: "Integration", status: "ai", views: 602, helpfulPct: 88, usedIn: 176, updatedLabel: "vor 2 Tagen" },
  { id: "billing-credits", title: "Credits & Limits", category: "Abrechnung", status: "stale", views: 846, helpfulPct: 71, usedIn: 143, updatedLabel: "vor 6 Wochen" },
  { id: "account-team", title: "Team einladen", category: "Konto", status: "current", views: 421, helpfulPct: 90, usedIn: 88, updatedLabel: "vor 4 Tagen" },
  { id: "integration-domain", title: "Eigene Domain verbinden", category: "Integration", status: "current", views: 388, helpfulPct: 85, usedIn: 64, updatedLabel: "vor 3 Wochen" },
  { id: "billing-invoice", title: "Rechnung herunterladen", category: "Abrechnung", status: "current", views: 274, helpfulPct: 96, usedIn: 39, updatedLabel: "vor 5 Tagen" },
  { id: "start-intro", title: "Erste Schritte mit HallofHelp", category: "Erste Schritte", status: "draft", views: 0, helpfulPct: 0, usedIn: 0, updatedLabel: "vor 1 Stunde" },
];

const TICKETS: Ticket[] = [
  {
    id: "t1",
    subject: "Widget lädt nicht auf meiner Seite",
    from: "lena@shop-beispiel.de",
    timeLabel: "vor 2 Std.",
    status: "new",
    excerpt: "Ich habe das Snippet eingebaut, aber es erscheint kein Button …",
    body: [
      "Ich habe das Snippet wie beschrieben vor dem schließenden Body-Tag eingebaut, aber auf der Seite erscheint kein Hilfe-Button.",
      "Nutze ich vielleicht die falsche Widget-ID? Wo finde ich die korrekte?",
    ],
  },
  {
    id: "t2",
    subject: "Rechnung mit falscher USt-ID",
    from: "buchhaltung@musterfirma.com",
    timeLabel: "vor 5 Std.",
    status: "open",
    excerpt: "Auf der letzten Rechnung steht eine veraltete Umsatzsteuer-ID …",
    body: ["Auf unserer letzten Rechnung steht eine veraltete USt-ID. Können Sie eine korrigierte Version ausstellen?"],
  },
  {
    id: "t3",
    subject: "KI antwortet auf Englisch statt Deutsch",
    from: "info@handwerk-mueller.de",
    timeLabel: "gestern",
    status: "open",
    excerpt: "Manche Antworten kommen auf Englisch, obwohl die Frage deutsch war …",
    body: ["Manche KI-Antworten kommen auf Englisch, obwohl die Frage auf Deutsch gestellt wurde. Lässt sich die Sprache erzwingen?"],
  },
  {
    id: "t4",
    subject: "Danke – super Tool!",
    from: "chris@startup-xy.io",
    timeLabel: "vor 2 Tagen",
    status: "resolved",
    excerpt: "Wollte nur Danke sagen, die Einrichtung war in Minuten erledigt.",
    body: ["Wollte nur Danke sagen — die Einrichtung war in wenigen Minuten erledigt und das Team ist begeistert."],
  },
];

const INVOICES: Invoice[] = [
  { id: "i1", dateLabel: "1. Juli 2026", amount: "49,00 €", number: "HOH-2026-07-001" },
  { id: "i2", dateLabel: "1. Juni 2026", amount: "49,00 €", number: "HOH-2026-06-001" },
  { id: "i3", dateLabel: "1. Mai 2026", amount: "49,00 €", number: "HOH-2026-05-001" },
];

const PLANS: PlanOption[] = [
  { id: "free", name: "Free", price: "0 €", includedLabel: "1.000", current: false },
  { id: "starter", name: "Starter", price: "49 €", includedLabel: "25.000", current: true },
  { id: "scale", name: "Scale", price: "199 €", includedLabel: "150.000", current: false },
];

const TOP_QUESTIONS: TopQuestion[] = [
  { id: "q1", text: "Wie binde ich das Widget ein?", count: 214, grounded: true },
  { id: "q2", text: "Wie setze ich mein Passwort zurück?", count: 176, grounded: true },
  { id: "q3", text: "Was kostet ein zusätzlicher Nutzer?", count: 132, grounded: false },
  { id: "q4", text: "Wie exportiere ich meine Daten?", count: 98, grounded: true },
  { id: "q5", text: "Kann ich eine eigene Domain nutzen?", count: 77, grounded: true },
];

const QUESTIONS_SERIES = [42, 55, 48, 61, 70, 66, 74, 81, 77, 88, 92, 85, 97, 104];

export const fakeAdmin = {
  kpis: (): Kpi[] => KPIS,
  articles: (): AdminArticleRow[] => ARTICLES,
  tickets: (): Ticket[] => TICKETS,
  invoices: (): Invoice[] => INVOICES,
  plans: (): PlanOption[] => PLANS,
  topQuestions: (): TopQuestion[] => TOP_QUESTIONS,
  questionsSeries: (): number[] => QUESTIONS_SERIES,
  usage: () => ({
    creditsUsed: 25400,
    creditsIncluded: 25000,
    mauUsed: 312,
    mauIncluded: 500,
    overageCredits: 400,
    overageAmount: "0,32 €",
    resetDate: "1. August 2026",
    graceDays: 23,
    planName: "Starter",
    planPrice: "49 €",
  }),
  openTicketCount: (): number => TICKETS.filter((t) => t.status !== "resolved").length,
};
