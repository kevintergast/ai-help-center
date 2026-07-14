// Dogfood-Content für die Operator-Instanz (Tenant `t_operator`, app.hallofhelp.com).
// QUELLE DER WAHRHEIT (versioniert). REGEL (CLAUDE.md): beschreibt ausschließlich den
// AKTUELL ausgelieferten, real funktionierenden Stand — kein „coming soon" in Artikeln.
// Bei jeder Feature-Änderung hier mitpflegen.
//
// Anwenden (idempotent, Upsert):
//   node scripts/seed-operator-content.mjs > /tmp/op-seed.sql
//   wrangler d1 execute hallofhelp-staging --file=/tmp/op-seed.sql --remote
//   wrangler d1 execute hallofhelp-prod --env production --file=/tmp/op-seed.sql --remote

const TENANT = "t_operator";
const LOCALE = "de";
// Feste Basis-Epoche (deterministisch, damit Re-Runs die Reihenfolge/Anlagezeit nicht verschieben).
const BASE = 1783000000;

/** Artikel: nur real funktionierende Fähigkeiten. body = Absatz-Array. related = Slugs. */
const ARTICLES = [
  {
    slug: "was-ist-hallofhelp",
    title: "Was ist HallofHelp?",
    category: "Erste Schritte",
    min: 2,
    body: [
      "HallofHelp ist ein White-Label-Hilfezentrum: Du richtest unter deiner eigenen Subdomain ein Hilfezentrum ein, versiehst es mit deinem Logo und deinen Farben und füllst es mit Artikeln.",
      "Deine Nutzer öffnen das Hilfezentrum, stöbern nach Kategorien und durchsuchen die Artikel. Zusätzlich kannst du eine Roadmap und einen Changelog pflegen, um Geplantes und Neuerungen transparent zu machen.",
      "Jedes Hilfezentrum ist strikt getrennt: eigene Subdomain, eigene Inhalte, eigenes Team und eigene Zugriffsrechte. Kein Kunde sieht die Daten eines anderen.",
      "Dieses Hilfezentrum, das du gerade liest, ist selbst mit HallofHelp gebaut — es ist unser lebendes Beispiel dafür, wie das Produkt genutzt wird.",
    ],
    related: ["hilfezentrum-erstellen", "artikel-veroeffentlichen"],
  },
  {
    slug: "hilfezentrum-erstellen",
    title: "Ein Hilfezentrum erstellen",
    category: "Erste Schritte",
    min: 2,
    body: [
      "Registriere dich auf app.hallofhelp.com und bestätige deine E-Mail-Adresse. Danach hast du Zugang zur Konsole.",
      "Wähle in der Konsole »Hilfezentrum erstellen« und lege eine Subdomain fest (zum Beispiel deinefirma.hallofhelp.com). Ist der Name frei, wird dein Hilfezentrum angelegt.",
      "HallofHelp richtet automatisch dein Owner-Konto im neuen Hilfezentrum ein und schickt dir eine E-Mail, über die du Passwort und Zwei-Faktor-Authentifizierung festlegst.",
      "Anschließend kannst du Branding, Team und Artikel deines Hilfezentrums pflegen.",
    ],
    related: ["konto-erstellen", "branding-anpassen"],
  },
  {
    slug: "konto-erstellen",
    title: "Konto erstellen & E-Mail bestätigen",
    category: "Konto & Anmeldung",
    min: 1,
    body: [
      "Registriere dich mit deiner E-Mail-Adresse und einem Passwort (mindestens 10 Zeichen).",
      "Wir senden dir eine Bestätigungs-E-Mail. Erst nach dem Klick auf den Bestätigungslink ist dein Konto aktiv und du kannst dich anmelden.",
      "Kommt keine E-Mail an, prüfe bitte deinen Spam-Ordner. Der Bestätigungslink ist zeitlich begrenzt gültig.",
    ],
    related: ["passwort-zuruecksetzen", "zwei-faktor-authentifizierung"],
  },
  {
    slug: "passwort-zuruecksetzen",
    title: "Passwort zurücksetzen",
    category: "Konto & Anmeldung",
    min: 1,
    body: [
      "Hast du dein Passwort vergessen, gib auf der Seite »Passwort vergessen« deine E-Mail-Adresse ein. Wir senden dir einen zeitlich begrenzten Link.",
      "Über den Link legst du ein neues Passwort fest (mindestens 10 Zeichen).",
      "Aus Sicherheitsgründen bestätigen wir nicht, ob zu einer E-Mail ein Konto existiert — sieh in jedem Fall in deinem Postfach nach.",
    ],
    related: ["konto-erstellen"],
  },
  {
    slug: "zwei-faktor-authentifizierung",
    title: "Zwei-Faktor-Authentifizierung (2FA)",
    category: "Konto & Anmeldung",
    min: 2,
    body: [
      "Für Team-Rollen ist Zwei-Faktor-Authentifizierung Pflicht — sie schützt die Verwaltung deines Hilfezentrums zusätzlich zum Passwort.",
      "Administratoren und der Owner sichern ihr Konto mit einer Authenticator-App (TOTP, etwa 1Password, Google Authenticator oder Authy). Beim Einrichten scannst du einen QR-Code und bestätigst einmalig einen Code.",
      "Bewahre die angezeigten Backup-Codes sicher auf — mit ihnen kommst du auch dann hinein, wenn du keinen Zugriff auf die App hast.",
    ],
    related: ["rollen-und-rechte", "konto-erstellen"],
  },
  {
    slug: "team-einladen",
    title: "Teammitglieder einladen",
    category: "Team & Rollen",
    min: 2,
    body: [
      "Als Administrator oder Owner lädst du Personen per E-Mail in dein Hilfezentrum ein und weist ihnen dabei eine Rolle zu.",
      "Der Einladungslink ist nur einmal verwendbar, zeitlich begrenzt und fest an die E-Mail-Adresse und dieses Hilfezentrum gebunden — er lässt sich nicht weitergeben.",
      "Beim Annehmen der Einladung richtet die eingeladene Person ihr Konto und die Zwei-Faktor-Authentifizierung ein und erhält anschließend die zugewiesene Rolle.",
    ],
    related: ["rollen-und-rechte", "zwei-faktor-authentifizierung"],
  },
  {
    slug: "rollen-und-rechte",
    title: "Rollen & Rechte",
    category: "Team & Rollen",
    min: 2,
    body: [
      "Es gibt vier Rollen mit aufsteigenden Rechten:",
      "• Nutzer: normale Leser des Hilfezentrums. • Redaktion (content): darf Artikel bearbeiten und veröffentlichen. • Admin: verwaltet zusätzlich Team, Einladungen und Einstellungen. • Owner: hat alle Rechte, inklusive Rechtstexte und der Übertragung der Eigentümerschaft.",
      "Pro Hilfezentrum gibt es genau einen Owner. Der Owner kann die Eigentümerschaft an einen Administrator übertragen; das erfordert eine frische Bestätigung per Zwei-Faktor-Authentifizierung.",
    ],
    related: ["team-einladen"],
  },
  {
    slug: "artikel-veroeffentlichen",
    title: "Artikel veröffentlichen",
    category: "Inhalte pflegen",
    min: 2,
    body: [
      "Artikel durchlaufen einen einfachen Lebenszyklus: Entwurf und veröffentlicht. Nur veröffentlichte Artikel sind für deine Nutzer im Hilfezentrum sichtbar.",
      "Im Verwaltungsbereich bearbeitest du Titel, Kategorie und die einzelnen Textabsätze eines Artikels und veröffentlichst ihn anschließend.",
      "Mit »Zurückziehen« wird ein Artikel wieder unsichtbar, ohne gelöscht zu werden. Jede Änderung wird als Version gesichert, sodass der Verlauf nachvollziehbar bleibt.",
      "Die Reihenfolge der Kategorien im Hilfezentrum ergibt sich aus der Reihenfolge, in der die Artikel angelegt wurden.",
    ],
    related: ["was-ist-hallofhelp"],
  },
  {
    slug: "branding-anpassen",
    title: "Logo & Farben anpassen",
    category: "Branding",
    min: 1,
    body: [
      "Im Verwaltungsbereich lädst du dein Logo hoch (PNG, JPEG oder WebP, maximal 1 MB) und legst deine Primär- und Akzentfarbe fest.",
      "Das Branding wird sofort im gesamten Hilfezentrum angewendet — ohne eine Zeile Code. So erscheint dein Hilfezentrum vollständig in deinem eigenen Look (White-Label).",
    ],
    related: ["hilfezentrum-erstellen"],
  },
  {
    slug: "rechtstexte",
    title: "Rechtstexte hinterlegen",
    category: "Rechtliches",
    min: 1,
    body: [
      "Als Owner hinterlegst du Rechtstexte wie Impressum oder Datenschutzerklärung — entweder als Link auf eine bestehende Seite oder direkt als Text (Markdown).",
      "Die Texte sind öffentlich über feste Pfade erreichbar und werden je Hilfezentrum getrennt gespeichert.",
    ],
    related: ["rollen-und-rechte"],
  },
];

/** Roadmap: ehrlich als geplant/in Arbeit markiert (keine Behauptung, dass es schon geht). */
const ROADMAP = [
  { title: "KI-gestützte Antworten aus deinen Artikeln", status: "in_progress", sort: 1 },
  { title: "Abrechnung & Credits (Self-Service)", status: "planned", sort: 2 },
  { title: "Einbettbares Chat-Widget", status: "planned", sort: 3 },
  { title: "Import & Export (Markdown, JSON)", status: "planned", sort: 4 },
];

/** Changelog: nur tatsächlich ausgelieferte Meilensteine. */
const CHANGELOG = [
  { title: "Produktions-Launch auf hallofhelp.com", description: "Mehrmandantenfähige Hilfezentren sind live — jedes unter eigener Subdomain.", at: BASE + 500 },
  { title: "Team, Rollen & Zwei-Faktor-Authentifizierung", description: "Einladungen, abgestufte Rollen und 2FA-Pflicht für Team-Rollen.", at: BASE + 300 },
  { title: "White-Label-Branding", description: "Logo und Farben pro Hilfezentrum, sofort angewendet.", at: BASE + 100 },
];

const esc = (s) => String(s).replace(/'/g, "''");
const out = [];
out.push("-- GENERIERT von scripts/seed-operator-content.mjs — nicht von Hand editieren.");
out.push("-- Idempotenter Dogfood-Content für t_operator (app.hallofhelp.com).");

ARTICLES.forEach((a, i) => {
  const id = "op_" + a.slug;
  const t = BASE + i * 10;
  const body = esc(JSON.stringify(a.body));
  const related = esc(JSON.stringify((a.related || []).map((s) => "op_" + s)));
  out.push(
    `INSERT INTO articles (id,tenant_id,locale,slug,title,category,status,body_json,videos_json,related_ids_json,reading_minutes,is_ai_generated,created_at,updated_at,published_at)\n` +
      `VALUES ('${id}','${TENANT}','${LOCALE}','${esc(a.slug)}','${esc(a.title)}','${esc(a.category)}','published','${body}','[]','${related}',${a.min || 1},0,${t},${t},${t})\n` +
      `ON CONFLICT(tenant_id,id) DO UPDATE SET locale=excluded.locale,slug=excluded.slug,title=excluded.title,category=excluded.category,status='published',body_json=excluded.body_json,related_ids_json=excluded.related_ids_json,reading_minutes=excluded.reading_minutes,updated_at=excluded.updated_at,published_at=COALESCE(articles.published_at,excluded.published_at);`,
  );
});

ROADMAP.forEach((r, i) => {
  const id = "op_rm_" + (i + 1);
  out.push(
    `INSERT INTO roadmap_items (id,tenant_id,title,status,sort) VALUES ('${id}','${TENANT}','${esc(r.title)}','${r.status}',${r.sort})\n` +
      `ON CONFLICT(tenant_id,id) DO UPDATE SET title=excluded.title,status=excluded.status,sort=excluded.sort;`,
  );
});

CHANGELOG.forEach((c, i) => {
  const id = "op_cl_" + (i + 1);
  out.push(
    `INSERT INTO changelog_entries (id,tenant_id,published_at,title,description) VALUES ('${id}','${TENANT}',${c.at},'${esc(c.title)}','${esc(c.description)}')\n` +
      `ON CONFLICT(tenant_id,id) DO UPDATE SET published_at=excluded.published_at,title=excluded.title,description=excluded.description;`,
  );
});

console.log(out.join("\n\n"));
