/*
  Demo-Inhalte des internen Brandbooks (Dev-/Test-Oberfläche).
  Bewusst als Daten gehalten (nicht als JSX-Literale): illustrative Specimen-Copy,
  keine echte Produkt-UI → gehört nicht in den i18n-Katalog.
*/

export const gateLabels = {
  title: "Interner Bereich",
  hint: "Dieses Brandbook ist per PIN geschützt. Bitte Code eingeben.",
  placeholder: "PIN",
  submit: "Entsperren",
  error: "Falscher PIN. Bitte erneut versuchen.",
};

export const themeToggleLabel = "Hell-/Dunkelmodus umschalten";

export const hero = {
  brandInitial: "H",
  brandName: "HallofHelp",
  eyebrow: "Brandbook · Design-System v0.1",
  title: "Ein warmes, mandantenfähiges Hilfezentrum.",
  lede: "Die verbindliche visuelle Sprache für HallofHelp — abgeleitet aus DESIGN.md (Lovable-inspiriert): warmes Parchment statt kaltem Weiß, eine humanistische Schrift, Tiefe aus Rändern statt Schatten. Jede Komponente unten ist ein echtes React-Specimen mit Light-/Dark-Support. Der Akzent ist pro Tenant austauschbar.",
};

export const nav = [
  { id: "farben", label: "Farben" },
  { id: "typografie", label: "Typografie" },
  { id: "raster", label: "Raster & Radius" },
  { id: "tiefe", label: "Tiefe" },
  { id: "whitelabel", label: "White-Label" },
  { id: "buttons", label: "Buttons" },
  { id: "formulare", label: "Formulare" },
  { id: "badges", label: "Badges" },
  { id: "navigation", label: "Navigation" },
  { id: "suche", label: "Suche & KI" },
  { id: "artikel", label: "Artikel" },
  { id: "prompt", label: "KI-Prompt" },
  { id: "suche-live", label: "Live-Suche" },
  { id: "dropdown", label: "Dropdown" },
  { id: "tabs", label: "Tabs" },
  { id: "faq", label: "FAQ" },
  { id: "controls", label: "Controls" },
  { id: "admin", label: "Admin" },
];

export interface Section {
  id: string;
  eyebrow: string;
  title: string;
  desc: string;
}

export const sections: Record<string, Section> = {
  farben: {
    id: "farben",
    eyebrow: "Fundament",
    title: "Farbpalette",
    desc: "Alle Grautöne stammen aus einem Charcoal bei variierender Deckkraft — das schafft tonale Einheit. Kein reines Weiß als Grund. Klick auf ein Feld kopiert den Wert.",
  },
  typografie: {
    id: "typografie",
    eyebrow: "Fundament",
    title: "Typografie",
    desc: "Produktschrift Camera Plain Variable, Fallback ui-sans-serif / system-ui. Zwei Gewichte: 400 (Fließtext/UI) und 600 (Überschriften). Hierarchie über Größe und negatives Letter-Spacing.",
  },
  raster: {
    id: "raster",
    eyebrow: "Fundament",
    title: "Raster & Radius",
    desc: "8px-Basisraster mit großzügiger Ausdehnung an Sektionsgrenzen. Sechs Radius-Stufen — die volle Pille bleibt Aktions- und Icon-Elementen vorbehalten.",
  },
  tiefe: {
    id: "tiefe",
    eyebrow: "Fundament",
    title: "Tiefe & Elevation",
    desc: "Bewusst flach: Ränder auf der Fläche schaffen Behälter, nicht Schlagschatten. Die Signatur ist der mehrschichtige Inset-Schatten auf Hochkontrast-Buttons.",
  },
  whitelabel: {
    id: "whitelabel",
    eyebrow: "Mandantenfähigkeit",
    title: "White-Label-Accent",
    desc: "Das Fundament bleibt konstant; jeder Tenant setzt nur seine Akzentfarbe über die CSS-Variable --brand-primary. Probier es — die Beispiele reagieren live.",
  },
  buttons: {
    id: "buttons",
    eyebrow: "Komponenten",
    title: "Buttons",
    desc: "8px 16px Padding, 6px Radius. Aktiv-Zustand: Deckkraft 0.8. Pillen nur für Icon- und Aktions-Toggles.",
  },
  formulare: {
    id: "formulare",
    eyebrow: "Komponenten",
    title: "Formulare & Eingaben",
    desc: "Flächen mit feinem Rand, 6px Radius. Fokus über weichen Blau-Ring statt scharfer Outline.",
  },
  badges: {
    id: "badges",
    eyebrow: "Komponenten",
    title: "Badges, Status & Pills",
    desc: "Semantische Farben (gut / Warnung / kritisch) sind vom Marken-Akzent getrennt. Wichtig fürs Hilfezentrum: der Aktualitäts-Status generierter Artikel.",
  },
  navigation: {
    id: "navigation",
    eyebrow: "Muster",
    title: "App-Shell & Navigation",
    desc: "Pro Tenant gethemter Header, fixiert. Logo links, Aktion rechts als Hochkontrast-Button mit Inset-Schatten.",
  },
  suche: {
    id: "suche",
    eyebrow: "Kernprodukt",
    title: "Suche & KI-Antwort",
    desc: "Die zentrale Suchleiste als einladende Pille. Die KI-Antwort ist immer geerdet: sie zeigt die Quellen-Artikel, aus denen sie zitiert.",
  },
  artikel: {
    id: "artikel",
    eyebrow: "Kernprodukt",
    title: "Artikel-Karten & Listen",
    desc: "12px Radius, feiner Rand, kein Schatten. Hover verdunkelt nur den Rand.",
  },
  admin: {
    id: "admin",
    eyebrow: "Admin",
    title: "Plan, Credits & Metriken",
    desc: "Informationsdichte Oberflächen: Zusammenfassung vor Detail, Zustand in Form und Zahl. Der Upgrade-Banner erscheint im Zustand over_limit während der 30-Tage-Kulanz.",
  },
  prompt: {
    id: "prompt",
    eyebrow: "Kernprodukt",
    title: "KI-Prompt-Eingabe",
    desc: "Das Herzstück: eine einladende Eingabe zum Fragen oder Suchen — mit Modus-Umschalter, Vorschlägen und Spracheingabe. Enter sendet, Shift+Enter macht eine neue Zeile.",
  },
  "suche-live": {
    id: "suche-live",
    eyebrow: "Kernprodukt",
    title: "Live-Suche mit Ergebnissen",
    desc: "Suchfeld, das beim Tippen sofort passende Artikel vorschlägt (Combobox mit Tastaturnavigation).",
  },
  dropdown: {
    id: "dropdown",
    eyebrow: "Komponenten",
    title: "Dropdown & Auswahl",
    desc: "Barrierefreie Select-Menüs für Filter und Sortierung — Tastatur, Klick-außerhalb, ausgewählter Zustand.",
  },
  tabs: {
    id: "tabs",
    eyebrow: "Komponenten",
    title: "Tabs",
    desc: "Umschalten zwischen Ansichten mit Pfeiltasten-Navigation und sichtbarem Fokus.",
  },
  faq: {
    id: "faq",
    eyebrow: "Komponenten",
    title: "FAQ / Accordion",
    desc: "Aufklappbare Frage-Antwort-Blöcke — ein Klassiker fürs Hilfezentrum.",
  },
  controls: {
    id: "controls",
    eyebrow: "Komponenten",
    title: "Schalter, Feedback & Overlays",
    desc: "Switch, „War das hilfreich?“, Tooltip sowie ein modaler Dialog und eine Toast-Meldung.",
  },
};

export const swatches: { name: string; value: string; role: string }[] = [
  { name: "Surface", value: "#f7f4ed", role: "Grund, Flächen" },
  { name: "Ink", value: "#1c1c1c", role: "Text, dunkle Buttons" },
  { name: "Surface raised", value: "#fcfbf8", role: "Karten, Inputs" },
  { name: "Muted", value: "#5f5f5d", role: "Sekundärtext" },
  { name: "Hairline", value: "#eceae4", role: "Ränder, Divider" },
  { name: "Hairline strong", value: "#c9c5ba", role: "Interaktive Ränder" },
  { name: "Brand (Default)", value: "#4f46e5", role: "Tenant-Akzent" },
  { name: "Ring", value: "#3b82f6", role: "Fokus-Ring" },
];

export const typeScale: { spec: string; sample: string; style: Record<string, string> }[] = [
  {
    spec: "Display · 60px / 600 / -1.5px",
    sample: "Antworten, die sitzen.",
    style: { fontSize: "52px", fontWeight: "600", lineHeight: "1.05", letterSpacing: "-1.5px" },
  },
  {
    spec: "Section · 36px / 600 / -0.9px",
    sample: "Wie richte ich mein Widget ein?",
    style: { fontSize: "34px", fontWeight: "600", lineHeight: "1.1", letterSpacing: "-0.9px" },
  },
  {
    spec: "Card-Titel · 20px / 600",
    sample: "Erste Schritte mit HallofHelp",
    style: { fontSize: "20px", fontWeight: "600", letterSpacing: "-0.3px" },
  },
  {
    spec: "Body Large · 18px / 400",
    sample: "Ein einleitender Absatz führt in ein Thema ein und bleibt angenehm lesbar.",
    style: { fontSize: "18px", lineHeight: "1.4" },
  },
  {
    spec: "Body · 16px / 400",
    sample: "Standard-Lesetext. Zeilenlänge nahe 65 Zeichen für komfortables Lesen im Artikel.",
    style: { fontSize: "16px", lineHeight: "1.5" },
  },
  {
    spec: "Caption · 14px / 400",
    sample: "Zuletzt aktualisiert vor 3 Tagen · 4 Min. Lesezeit",
    style: { fontSize: "14px" },
  },
];

export const radii = [
  { label: "4px · Micro", value: "4px" },
  { label: "6px · Standard", value: "6px" },
  { label: "8px · Komfort", value: "8px" },
  { label: "12px · Card", value: "12px" },
  { label: "16px · Container", value: "16px" },
  { label: "Pill", value: "9999px" },
];

export const spacing = [8, 12, 16, 24, 32, 40, 56, 80];

export const elevation = [
  { label: "Level 1 · Bordered", kind: "bordered" as const },
  { label: "Level 2 · Inset (Button)", kind: "inset" as const },
  { label: "Level 3 · Focus-Glow", kind: "focus" as const },
  { label: "Ring · Tastaturfokus", kind: "ring" as const },
];

export const accents = [
  { name: "Indigo", value: "#4f46e5" },
  { name: "Teal", value: "#0f766e" },
  { name: "Amber", value: "#b4530a" },
  { name: "Rosé", value: "#be185d" },
  { name: "Charcoal", value: "#1c1c1c" },
];

export const buttonLabels = {
  primary: "Primär (Inset)",
  brand: "Tenant-Akzent",
  ghost: "Ghost / Outline",
  cream: "Cream Surface",
  small: "Klein",
  pill: "Plan-Modus",
  micDesc: "Mikrofon",
  variants: "Varianten",
};

export const whitelabel = {
  choose: "Tenant-Akzent wählen",
  affects: "Betrifft Buttons, Links, Akzente, Diagramme.",
  cta: "Jetzt starten",
  docs: "Zur Dokumentation",
  plan: "Pro-Plan",
};

export const forms = {
  email: "E-Mail-Adresse",
  emailPh: "name@firma.de",
  title: "Artikel-Titel",
  titleVal: "Widget einbinden",
  desc: "Beschreibung",
  descPh: "Worum geht es in diesem Artikel?",
};

export const badges = {
  statusHead: "Status-Badges",
  suggestHead: "Vorschlags-Pills (Suche / Chat)",
  current: "Aktuell",
  stale: "Veraltet",
  frozen: "Eingefroren",
  draft: "Entwurf",
  ai: "KI-generiert",
  suggestions: [
    "Passwort zurücksetzen",
    "Rechnung herunterladen",
    "Widget-Farbe ändern",
    "Team einladen",
  ],
};

export const shell = {
  tenant: "Acme Support",
  initial: "A",
  links: ["Artikel", "Kategorien", "Kontakt"],
  cta: "Anmelden",
  body: "Inhaltsbereich · max. 1200px zentriert · großzügige vertikale Ränder",
};

export const searchDemo = {
  placeholder: "Wonach suchst du? Frag ganz normal …",
  answerHeading: "KI-Antwort",
  grounded: "Geerdet · 3 Quellen",
  answerBody:
    "Um dein Widget einzubinden, kopierst du das Snippet aus Einstellungen → Widget und fügst es vor dem schließenden Body-Tag deiner Seite ein. Die Farben übernimmt es automatisch aus deinem Branding.",
  citations: [
    { n: 1, title: "Widget einrichten" },
    { n: 2, title: "Branding & Farben" },
    { n: 3, title: "Snippet-Referenz" },
  ],
};

export const articles = {
  galleryLabel: "Karten-Galerie",
  listLabel: "Listenzeilen",
  cards: [
    {
      category: "Erste Schritte",
      title: "Konto einrichten",
      excerpt: "In fünf Minuten vom leeren Workspace zum ersten veröffentlichten Artikel.",
      status: "current" as const,
    },
    {
      category: "Abrechnung",
      title: "Credits & Limits",
      excerpt: "Wie Credits verbraucht werden und was bei Erreichen des Limits passiert.",
      status: "stale" as const,
    },
    {
      category: "Integration",
      title: "Widget einbinden",
      excerpt: "Das Hilfe-Widget auf jeder Seite einbetten und an dein Branding anpassen.",
      status: "ai" as const,
    },
  ],
  rows: [
    { title: "Rechnung herunterladen", meta: "Abrechnung · vor 2 Tagen aktualisiert", status: "current" as const },
    { title: "Team-Mitglieder verwalten", meta: "Konto · vor 5 Wochen aktualisiert", status: "stale" as const },
  ],
};

export const admin = {
  bannerTitle: "Credit-Limit erreicht — noch 23 Tage Kulanz",
  bannerDesc:
    "Dein Hilfezentrum läuft normal weiter. Danach pausiert die KI-Generierung, bis du upgradest. Nichts wird gelöscht.",
  upgrade: "Upgrade",
  planHead: "Aktueller Plan",
  planName: "Starter · 49 €",
  planPer: "/Mo",
  credits: "Credits",
  creditsVal: "25.400 / 25.000",
  mau: "Aktive Nutzer (MAU)",
  mauVal: "312 / 500",
  managePlan: "Plan verwalten",
  usageDetail: "Nutzung im Detail",
  monthHead: "Diesen Monat",
  stats: [
    { value: "1,2k", label: "Fragen beantwortet" },
    { value: "89%", label: "geerdet" },
    { value: "42", label: "Artikel live" },
    { value: "7", label: "veraltet" },
  ],
  tableLabel: "Tabelle",
  tableHead: { article: "Artikel", category: "Kategorie", views: "Aufrufe", status: "Status" },
  tableRows: [
    { article: "Konto einrichten", category: "Erste Schritte", views: "1.284", status: "current" as const },
    { article: "Credits & Limits", category: "Abrechnung", views: "846", status: "stale" as const },
    { article: "Widget einbinden", category: "Integration", views: "602", status: "ai" as const },
  ],
  emptyLabel: "Leerer Zustand",
  emptyTitle: "Noch keine Artikel",
  emptyDesc: "Erstelle deinen ersten Artikel oder lass die KI aus einer Frage einen Entwurf generieren.",
  emptyCta: "Artikel erstellen",
};

export const footerNote =
  "HallofHelp Brandbook · abgeleitet aus DESIGN.md (Lovable-inspiriert). Produktschrift Camera Plain Variable mit System-Fallback. Light + Dark über Design-Tokens.";

/** Status-Schlüssel → Badge-Ton + Label (Aktualität generierter Artikel). */
export const statusMap = {
  current: { tone: "ok" as const, label: badges.current },
  stale: { tone: "warn" as const, label: badges.stale },
  frozen: { tone: "crit" as const, label: badges.frozen },
  ai: { tone: "brand" as const, label: badges.ai },
};
export type StatusKey = keyof typeof statusMap;

// — Interaktive Elemente —

export const promptDemo = {
  placeholder: "Frag die KI etwas — oder beschreib dein Problem …",
  modes: [
    { id: "ask", label: "Fragen" },
    { id: "search", label: "Suchen" },
  ],
  suggestions: [
    "Wie binde ich das Widget ein?",
    "Rechnung stornieren",
    "Passwort vergessen",
  ],
  send: "Senden",
  mic: "Spracheingabe",
  sentToast: "Anfrage gesendet (Demo).",
  toastClose: "Schließen",
};

export const liveSearch = {
  placeholder: "Artikel durchsuchen …",
  ariaLabel: "Artikel-Suche",
  emptyLabel: "Keine Treffer — formuliere es anders.",
  items: [
    { id: "a1", title: "Konto einrichten", category: "Erste Schritte" },
    { id: "a2", title: "Widget einbinden", category: "Integration" },
    { id: "a3", title: "Credits & Limits", category: "Abrechnung" },
    { id: "a4", title: "Team einladen", category: "Konto" },
    { id: "a5", title: "Eigene Domain verbinden", category: "Integration" },
    { id: "a6", title: "Rechnung herunterladen", category: "Abrechnung" },
  ],
};

export const dropdownDemo = {
  filterLabel: "Kategorie",
  categoryAria: "Kategorie filtern",
  categoryPlaceholder: "Kategorie wählen",
  categories: [
    { value: "all", label: "Alle Kategorien" },
    { value: "start", label: "Erste Schritte" },
    { value: "billing", label: "Abrechnung" },
    { value: "integration", label: "Integration" },
  ],
  sortSectionLabel: "Sortierung",
  sortAria: "Sortieren nach",
  sorts: [
    { value: "relevance", label: "Relevanz" },
    { value: "recent", label: "Zuletzt aktualisiert" },
    { value: "views", label: "Aufrufe" },
  ],
};

export const tabsDemo = {
  ariaLabel: "Ergebnis-Ansichten",
  items: [
    { id: "all", label: "Alle", body: "Kombinierte Ansicht aus KI-Antwort und passenden Artikeln." },
    { id: "articles", label: "Artikel", body: "Nur die Wissensartikel, nach Relevanz sortiert." },
    {
      id: "ai",
      label: "KI-Antworten",
      body: "Generierte Antworten mit Quellenangaben und Aktualitäts-Status.",
    },
  ],
};

export const faqDemo = {
  items: [
    {
      id: "f1",
      question: "Was kostet HallofHelp?",
      answer:
        "Es gibt einen kostenlosen Einstieg bis zu einem Limit; danach zahlst du planbasiert mit inkludierten Credits und fairer Overage.",
    },
    {
      id: "f2",
      question: "Kann ich mein eigenes Branding nutzen?",
      answer:
        "Ja — Logo, Farben und Sprache kommen pro Mandant aus dem Branding. Dafür ist kein Code nötig.",
    },
    {
      id: "f3",
      question: "Woher weiß die KI die Antworten?",
      answer:
        "Aus deinen eigenen Artikeln (RAG). Jede Antwort zeigt die Quellen, aus denen sie zitiert.",
    },
  ],
};

export const controls = {
  switchesLabel: "Schalter",
  overlaysLabel: "Feedback & Overlays",
  switchEmail: "E-Mail-Benachrichtigungen",
  switchDigest: "Wöchentliche Zusammenfassung",
  feedbackQuestion: "War dieser Artikel hilfreich?",
  feedbackYes: "Ja, hat geholfen",
  feedbackNo: "Nein, nicht hilfreich",
  feedbackThanks: "Danke für dein Feedback!",
  openDialog: "Kontakt aufnehmen",
  dialogTitle: "Support kontaktieren",
  dialogBody:
    "Beschreibe dein Anliegen — unser Team meldet sich per E-Mail. In Produktion stünde hier ein echtes Formular.",
  dialogConfirm: "Absenden",
  dialogCancel: "Abbrechen",
  dialogClose: "Schließen",
  showToast: "Toast anzeigen",
  toastMessage: "Änderungen gespeichert.",
  toastClose: "Schließen",
  tooltipTrigger: "Was sind Credits?",
  tooltipText: "Credits = Verbrauchseinheiten pro KI-Aktion.",
};
