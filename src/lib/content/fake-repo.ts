import { parseArticleBody } from "./blocks";
import type {
  Article,
  ArticleSummary,
  AskAnswer,
  CategoryGroup,
  ChangelogEntry,
  HelpCenterRepository,
  RoadmapItem,
} from "./types";

/*
  SAMPLE-CONTENT fürs Hilfezentrum (Beispieldaten, keine UI-Strings — deshalb
  bewusst NICHT im i18n-Katalog). Zweck heute:
    1. DEV-Fallback (`sampleHelpCenterRepo`): OHNE Cloudflare-Kontext (reines
       `next dev`, Unit-Tests) hat kein Tenant echte D1-Artikel — dann liefert
       das Hilfezentrum diese Beispiele, damit die UI etwas zeigt.
    2. DEV-SEED (src/server/content/seed.ts): schreibt genau diese Artikel für die
       Demo-Tenants in die LOKALE D1, damit Admin + Hilfezentrum lokal Inhalte haben.

  `status`/`updatedLabel` sind hier die ANZEIGE-Formen (der Seed mappt sie auf die
  Storage-Formen draft/published/archived + Zeitstempel).
*/

// Rohdaten mit string[]-Bodies (lesbar); Export normalisiert zu Blöcken.
const RAW_SAMPLE_ARTICLES: (Omit<Article, "body"> & { body: string[] })[] = [
  {
    id: "start-account",
    slug: "konto-einrichten",
    title: "Konto einrichten",
    category: "Erste Schritte",
    status: "current",
    updatedLabel: "vor 3 Tagen",
    readingMinutes: 4,
    body: [
      "Nach der Registrierung führt dich der Einrichtungs-Assistent in wenigen Minuten zum ersten veröffentlichten Artikel. Du legst Name und Sprache deines Hilfezentrums fest und lädst optional dein Logo hoch.",
      "Deine Farben und dein Logo werden sofort übernommen — das gesamte Hilfezentrum erscheint in deinem Branding, ohne dass du etwas programmieren musst.",
    ],
    videos: [
      {
        id: "v1",
        title: "Rundgang: Das Dashboard in 90 Sekunden",
        durationLabel: "1:30",
        description: "Kurzer Rundgang durch das Dashboard und die wichtigsten Bereiche.",
      },
    ],
    relatedIds: ["start-intro", "account-team"],
  },
  {
    id: "start-intro",
    slug: "erste-schritte",
    title: "Erste Schritte mit HallofHelp",
    category: "Erste Schritte",
    status: "current",
    updatedLabel: "vor 1 Woche",
    readingMinutes: 3,
    body: [
      "HallofHelp beantwortet Fragen deiner Nutzer, indem die KI aus deinen eigenen Artikeln eine passende Antwort zusammenstellt — mit Quellenangabe. Je besser deine Artikel, desto besser die Antworten.",
      "Beginne mit drei bis fünf Kernartikeln zu den häufigsten Fragen. Den Rest kannst du nach und nach ergänzen; die KI nutzt sofort, was vorhanden ist.",
    ],
    videos: [],
    relatedIds: ["start-account", "integration-widget"],
  },
  {
    id: "integration-widget",
    slug: "widget-einbinden",
    title: "Widget einbinden",
    category: "Integration",
    status: "ai",
    updatedLabel: "vor 2 Tagen",
    readingMinutes: 5,
    body: [
      "Kopiere das Snippet aus Einstellungen → Widget und füge es vor dem schließenden Body-Tag deiner Seite ein. Das Widget übernimmt Farben und Sprache automatisch aus deinem Branding.",
      "Auf mobilen Geräten öffnet sich das Widget als Vollbild-Ansicht; auf dem Desktop als eingebettete Seitenleiste. Beides ist ohne weitere Konfiguration einsatzbereit.",
    ],
    videos: [
      {
        id: "v2",
        title: "Widget in unter 2 Minuten einbinden",
        durationLabel: "1:48",
        description: "Schritt-für-Schritt: Snippet kopieren und auf der Seite einbauen.",
      },
      {
        id: "v3",
        title: "Widget an dein Branding anpassen",
        durationLabel: "2:12",
        description: "Farben, Logo und Position des Widgets an dein Branding angleichen.",
      },
    ],
    relatedIds: ["integration-domain", "start-intro"],
  },
  {
    id: "integration-domain",
    slug: "eigene-domain-verbinden",
    title: "Eigene Domain verbinden",
    category: "Integration",
    status: "current",
    updatedLabel: "vor 3 Wochen",
    readingMinutes: 6,
    body: [
      "Auf bezahlten Plänen kannst du dein Hilfezentrum unter deiner eigenen Domain betreiben. Du legst einen CNAME-Eintrag an, der auf uns zeigt; das Zertifikat wird automatisch ausgestellt.",
      "Bis die Domain verifiziert ist, bleibt deine kostenlose Subdomain erreichbar. Es gibt also keine Ausfallzeit beim Umzug.",
    ],
    videos: [],
    relatedIds: ["integration-widget"],
  },
  {
    id: "billing-credits",
    slug: "credits-und-limits",
    title: "Credits & Limits",
    category: "Abrechnung",
    status: "stale",
    updatedLabel: "vor 6 Wochen",
    readingMinutes: 4,
    body: [
      "Jede KI-Generierung verbraucht Credits; das Aufrufen bestehender Artikel und die Suche sind kostenlos. Dein Plan enthält ein monatliches Kontingent, darüber hinaus wird fair nachberechnet.",
      "Wird ein Limit erreicht, läuft dein Hilfezentrum 30 Tage normal weiter. Erst danach pausiert die KI-Generierung, bis du dein Kontingent erhöhst — gelöscht wird nichts.",
    ],
    videos: [],
    relatedIds: ["billing-invoice"],
  },
  {
    id: "billing-invoice",
    slug: "rechnung-herunterladen",
    title: "Rechnung herunterladen",
    category: "Abrechnung",
    status: "current",
    updatedLabel: "vor 5 Tagen",
    readingMinutes: 2,
    body: [
      "Deine Rechnungen findest du unter Einstellungen → Abrechnung. Jede Rechnung lässt sich als PDF herunterladen und enthält die für dein Land nötigen Steuerangaben.",
      "Die Zahlungsabwicklung erfolgt über unseren Zahlungsdienstleister; Rechnungsadresse und Umsatzsteuer-ID kannst du dort jederzeit anpassen.",
    ],
    videos: [],
    relatedIds: ["billing-credits"],
  },
  {
    id: "account-team",
    slug: "team-einladen",
    title: "Team einladen",
    category: "Konto",
    status: "current",
    updatedLabel: "vor 4 Tagen",
    readingMinutes: 3,
    body: [
      "Unter Einstellungen → Team lädst du Kolleginnen und Kollegen per E-Mail ein und weist ihnen eine Rolle zu. Die Einladung ist zeitlich begrenzt und nur einmal verwendbar.",
      "Rollen steuern, wer Artikel bearbeiten, veröffentlichen oder Einstellungen ändern darf. So bleibt die Pflege übersichtlich und sicher.",
    ],
    videos: [],
    relatedIds: ["start-account"],
  },
];

export const SAMPLE_ARTICLES: Article[] = RAW_SAMPLE_ARTICLES.map((a) => ({
  ...a,
  body: parseArticleBody(a.body),
}));

export const SAMPLE_ROADMAP: RoadmapItem[] = [
  { id: "r1", title: "Video-Kapitel mit Sprungmarken", status: "in_progress" },
  { id: "r2", title: "Mehr Sprachen für die KI-Antworten", status: "planned" },
  { id: "r3", title: "Statistik-Export als CSV", status: "planned" },
  { id: "r4", title: "Widget-Themes pro Seite", status: "shipped" },
];

export const SAMPLE_CHANGELOG: ChangelogEntry[] = [
  {
    id: "c1",
    dateLabel: "8. Juli 2026",
    title: "Quellenangaben in KI-Antworten",
    description: "Jede generierte Antwort zeigt jetzt die Artikel, aus denen sie zitiert.",
  },
  {
    id: "c2",
    dateLabel: "1. Juli 2026",
    title: "Dunkelmodus",
    description: "Das Hilfezentrum passt sich automatisch an das System-Theme an.",
  },
  {
    id: "c3",
    dateLabel: "24. Juni 2026",
    title: "Schnellere Suche",
    description: "Ergebnisse erscheinen jetzt sofort beim Tippen.",
  },
];

export const SAMPLE_SUGGESTIONS = [
  "Wie binde ich das Widget ein?",
  "Was passiert, wenn mein Credit-Limit erreicht ist?",
  "Wie lade ich mein Team ein?",
];

const toSummary = (a: Article): ArticleSummary => ({
  id: a.id,
  slug: a.slug,
  title: a.title,
  category: a.category,
  status: a.status,
  updatedLabel: a.updatedLabel,
});

export function groupByCategory(articles: Article[]): CategoryGroup[] {
  const order: string[] = [];
  const byCat = new Map<string, ArticleSummary[]>();
  for (const a of articles) {
    if (!byCat.has(a.category)) {
      byCat.set(a.category, []);
      order.push(a.category);
    }
    byCat.get(a.category)!.push(toSummary(a));
  }
  return order.map((category) => ({ category, articles: byCat.get(category)! }));
}

/**
 * DEV-Fallback-Repository (async, wie das D1-Facade). Bedient das Hilfezentrum
 * OHNE Cloudflare-Kontext aus den Sample-Daten. Nur lesend — Pflege läuft
 * ausschließlich über die (D1-gestützte) Admin-API.
 */
export const sampleHelpCenterRepo: HelpCenterRepository = {
  listByCategory: async () => groupByCategory(SAMPLE_ARTICLES),
  searchItems: async () => SAMPLE_ARTICLES.map(toSummary),
  listArticles: async () => SAMPLE_ARTICLES,
  siblingsOf: async () => [],
  getArticle: async (slugOrId) =>
    SAMPLE_ARTICLES.find((a) => a.id === slugOrId || a.slug === slugOrId) ?? null,
  roadmap: async () => SAMPLE_ROADMAP,
  changelog: async () => SAMPLE_CHANGELOG,
  promptSuggestions: async () => SAMPLE_SUGGESTIONS,
};
