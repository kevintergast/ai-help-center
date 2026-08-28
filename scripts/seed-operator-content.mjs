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
// Release-Zeitpunkte (fest, damit Re-Runs nichts verschieben — aber mit dem
// tatsächlichen Datum, sonst lesen Nutzer ein falsches „veröffentlicht am").
const RELEASE_0_2_0 = 1787492800; // 2026-08-23

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
      "Im Verwaltungsbereich baust du Artikel aus BLÖCKEN: Textblöcke (auch als Info-, Warnungs-, Fehler-Hinweis oder Code), Bilder, Videos und »Artikel verlinken«-Karten mit eigenem Titel, Beschreibung und farbigem Tag. Die Reihenfolge der Blöcke ist die Reihenfolge im Artikel — per Pfeiltasten sortierst du um.",
      "Zusätzlich kannst du jedem Artikel ein Flag geben (z. B. »Beta« oder »Wichtig«) — ein farbiges Badge, das neben dem Status angezeigt wird.",
      "Für Feld- und Parameter-Übersichten gibt es den Tabellen-Block: Du tippst die Zeilen mit | als Spaltentrenner, die erste Zeile ist die Kopfzeile — angezeigt wird eine saubere Tabelle.",
      "Weitere Bausteine: »Aufklappbar« versteckt Details hinter einem Titel (gut für FAQ und Sonderfälle), »Button« setzt eine Handlungsaufforderung mit Ziel-Adresse, »Trennlinie« gliedert lange Artikel, und »Datei« hängt eine Vorlage zum Herunterladen an (PDF, CSV, TXT, DOCX, XLSX, PPTX bis 10 MB).",
      "Aufklappbare Abschnitte bleiben für die KI-Suche sichtbar: Der Inhalt wird indexiert, auch wenn er beim Lesen erst nach einem Klick erscheint. Ein Beispiel siehst du direkt hier:",
      {
        type: "accordion",
        title: "Wann nehme ich »Zurückziehen« und wann »Entwurf speichern«?",
        text:
          "»Entwurf speichern« ist für Artikel, die noch nie veröffentlicht waren — sie bleiben unsichtbar, bis du sie veröffentlichst.\n\n»Zurückziehen« nimmst du für einen bereits veröffentlichten Artikel, den du in Ruhe umbauen willst: Er verschwindet aus dem Hilfezentrum, bleibt aber mit allen Inhalten bestehen.",
      },
      "Mit »Zurückziehen« wird ein Artikel wieder unsichtbar, ohne gelöscht zu werden. Jede Änderung wird als Version gesichert, sodass der Verlauf nachvollziehbar bleibt.",
      "Beim Bearbeiten hast du zwei Wege: »Entwurf speichern« sichert deinen Stand, ohne ihn zu veröffentlichen — du kannst später weiterarbeiten und den Artikel erst dann online stellen. »Veröffentlichen« macht ihn sichtbar. Bei einem bereits veröffentlichten Artikel sind gespeicherte Änderungen sofort live; willst du in Ruhe umbauen, ziehe ihn vorher mit »Zurückziehen« offline.",
      "Solltest du die Seite mit ungespeicherten Änderungen verlassen wollen — etwa durch einen Klick auf einen Link — fragt der Editor nach und bietet an, vorher zu speichern. Nichts geht mehr verloren.",
      "Endgültig löschen kannst du einen Artikel im Editor (Bearbeiten-Modus, »Artikel löschen«) — nach einer Bestätigung werden auch seine Bilder und der Such-Index-Eintrag entfernt. Andere Sprachfassungen bleiben bestehen.",
      "Jede Überschrift in einem veröffentlichten Artikel ist einzeln verlinkbar: Beim Überfahren erscheint ein kleines Link-Symbol — ein Klick kopiert die Adresse direkt zu diesem Abschnitt, ideal um Kunden auf genau eine Stelle zu verweisen.",
      "Ab drei Überschriften zeigt der Artikel zusätzlich ein Inhaltsverzeichnis — auf großen Bildschirmen rechts neben dem Text, auf dem Handy über dem Artikel. Es entsteht automatisch aus deinen Überschriften; du musst nichts pflegen.",
      "Die Reihenfolge der Kategorien im Hilfezentrum ergibt sich aus der Reihenfolge, in der die Artikel angelegt wurden.",
    ],
    related: ["was-ist-hallofhelp"],
  },
  {
    slug: "inhalte-importieren-exportieren",
    title: "Inhalte importieren & exportieren",
    category: "Inhalte pflegen",
    min: 3,
    body: [
      "Deine Inhalte gehören dir: Über »Export« in der Artikel-Verwaltung lädst du jederzeit alle Artikel als JSON-Datei herunter — verlustfrei und in jede andere Instanz reimportierbar (kein Lock-in).",
      "Für den Import gibt es zwei Formate: unsere JSON-Export-Datei (mehrere Artikel auf einmal) oder eine Markdown-Datei je Artikel. Der Import-Dialog erklärt beide Formate und bietet Beispieldateien zum Herunterladen — so siehst du genau, wie deine Datei aufgebaut sein muss.",
      "Markdown-Aufbau: optionaler Kopf zwischen ---‑Zeilen (slug, category, locale), dann # Titel, Absätze durch Leerzeilen. Zwischenüberschriften (##), Listen, **fett** und [Links] bleiben erhalten.",
      "Bilder reisen nicht als Datei mit. Stattdessen werden Bildverweise (im Markdown ![Beschreibung](bild.png), im JSON images-Einträge) als VORMERKUNG angelegt: Der Artikel-Editor zeigt dir, welche Bilder noch fehlen, übernimmt die Beschreibung und du lädst das Bild dort mit einem Klick nach.",
      "Am schnellsten geht der Umzug von einer bestehenden Hilfe-Seite: Gib im Import-Dialog unter »Von einer Website importieren« die Adressen der Artikel an (eine pro Zeile). Wir holen Titel, Text, Überschriften, Listen, Bilder und YouTube-Videos in der Original-Reihenfolge — Bilder werden mit ihrem Alternativtext als Beschreibung in dein Hilfezentrum kopiert. Voraussetzung: Die Seite liefert ihren Inhalt im HTML (bei rein per JavaScript aufgebauten Seiten bleibt der Datei-Import).",
      "Wichtig: Importiere nur Inhalte, die dir gehören oder für die du die Rechte hast. Video-Beschreibungen setzt du danach im Editor über »Inhalt automatisch erfassen«.",
      "Für größere Umzüge gibt es einen dritten Weg: Verbinde deinen eigenen KI-Client per MCP und lass ihn die Seiten übernehmen. Der Vorteil gegenüber dem Dialog ist die Nacharbeit — dein KI-Client kann jedes übernommene Bild ansehen und daraus eine echte Beschreibung schreiben, statt nur den Alternativtext der alten Seite zu übernehmen. Wie das geht, steht unter »Eigenen KI-Client verbinden (MCP)«.",
      "Übernommen werden auch Tabellen und Hinweisboxen: Tabellen werden zu Tabellen-Blöcken, farbige Hinweise zu Info-, Warnungs- oder Fehler-Blöcken.",
      "Importierte neue Artikel starten immer als Entwurf — veröffentlicht wird bewusst von Hand. Existiert ein Artikel mit gleichem Slug bereits, wird sein Inhalt aktualisiert; sein Status bleibt unverändert.",
    ],
    related: ["artikel-veroeffentlichen"],
  },
  {
    slug: "branding-anpassen",
    title: "Logo & Farben anpassen",
    category: "Branding",
    min: 1,
    body: [
      "In den Einstellungen lädst du dein Logo hoch (PNG, JPEG oder WebP, maximal 1 MB) und legst deine Primär- und Akzentfarbe fest — jede Karte speichert direkt beim Klick.",
      "Optional hinterlegst du ein zweites Logo für den dunklen Modus: Besucher mit Dark Mode sehen dann automatisch die passende Variante. Ohne dunkles Logo wird überall das helle gezeigt.",
      "Steckt dein Schriftzug bereits im Logo, kannst du die Anzeige des Instanznamens im Header abschalten (Schalter in den Branding-Einstellungen). Ohne Logo wird der Name immer angezeigt.",
      "Das Branding wird sofort im gesamten Hilfezentrum angewendet — ohne eine Zeile Code. So erscheint dein Hilfezentrum vollständig in deinem eigenen Look (White-Label).",
      "Ebenfalls in den Einstellungen: die Standardsprache deines Hilfezentrums (Deutsch oder Englisch) — sie kann nur der Besitzer ändern.",
    ],
    related: ["hilfezentrum-erstellen"],
  },
  {
    slug: "rechtstexte",
    title: "Rechtstexte hinterlegen",
    category: "Rechtliches",
    min: 1,
    body: [
      "Als Owner hinterlegst du Rechtstexte wie Impressum oder Datenschutzerklärung — entweder als Link auf eine bestehende Seite oder direkt als Text (Markdown), auch per Datei-Upload.",
      "Die Texte sind öffentlich über feste Pfade erreichbar und werden je Hilfezentrum getrennt gespeichert.",
    ],
    related: ["rollen-und-rechte"],
  },
  {
    slug: "ki-antworten",
    title: "KI-Antworten: dynamische Hilfeartikel",
    category: "Erste Schritte",
    min: 2,
    body: [
      "Auf der Startseite deines Hilfezentrums können Nutzer der KI eine Frage stellen. Die Antwort wird live aus deinen veröffentlichten Artikeln zusammengestellt — als kompakter, dynamischer Hilfeartikel mit Quellenangaben zum Weiterlesen. Auch deine Roadmap- und Changelog-Einträge kann die KI dabei berücksichtigen.",
      "Die KI antwortet nur, wenn deine Artikel die Frage tatsächlich hergeben. Findet sie keine belastbare Grundlage, sagt sie das ehrlich, statt etwas zu erfinden — dann hilft es, die Frage anders zu formulieren oder den passenden Artikel zu ergänzen.",
      "Unter jeder Antwort können Nutzer mit »War das hilfreich?« Feedback geben und über »Etwas stimmt nicht?« direkt den Support kontaktieren. Beides siehst du im Admin-Bereich: die Hilfreich-Quote in der Statistik, Support-Anfragen in der Inbox.",
      "Nutzer können generierte Antworten auf ihrem Gerät speichern und später wieder öffnen. Beantwortet wird in der Sprache, in der die Frage gestellt wurde.",
      "Neue oder geänderte Artikel stehen der KI kurz nach dem Veröffentlichen zur Verfügung — der Suchindex aktualisiert sich automatisch. In der Statistik zeigt dir »Häufigste Quellen«, welche Artikel deine KI-Antworten am meisten speisen.",
    ],
    related: ["artikel-veroeffentlichen", "credits-und-limits", "widget-einbinden"],
  },
  {
    slug: "credits-und-limits",
    title: "Credits & Limits",
    category: "Plan & Credits",
    min: 2,
    body: [
      "Die Nutzung deines Hilfezentrums wird in Credits gemessen: Ein Artikel-Aufruf durch Besucher kostet 1 Credit, eine KI-Antwort 20 Credits, eine KI-Übersetzung eines Artikels 50 Credits. Die Suche ist kostenlos. Artikel-Aufrufe durch dich und dein Team werden nie berechnet; KI-Antworten deines Teams zählen zu einem reduzierten internen Satz.",
      "Jeder Plan enthält ein monatliches Credit-Kontingent und eine Obergrenze aktiver Nutzer. Beides setzt sich am Monatsanfang automatisch zurück. Deinen aktuellen Verbrauch siehst du jederzeit im Admin-Bereich unter »Plan & Credits«. Für größere Anforderungen gibt es den Enterprise-Tarif — sprich dazu direkt mit unserem Vertrieb.",
      "Erreichst du ein Limit, läuft dein Hilfezentrum zunächst 30 Tage normal weiter — du siehst einen Hinweis mit Countdown. Erst danach pausieren KI-Antworten und Inhalts-Änderungen, bis du upgradest. Deine Artikel bleiben dabei durchgehend öffentlich sichtbar; es wird nichts gelöscht.",
    ],
    related: ["ki-antworten"],
  },
  {
    slug: "widget-einbinden",
    title: "Widget: KI-Hilfe auf deiner Website",
    category: "Integration",
    min: 2,
    body: [
      "Mit dem Widget holst du die KI-Hilfe deines Hilfezentrums direkt auf deine eigene Website: Unten rechts erscheint ein Hilfe-Button in deiner Markenfarbe; ein Klick öffnet den Chat, in dem Besucher Fragen stellen, Quellen-Artikel öffnen, Feedback geben und den Support erreichen.",
      "Die Einbindung ist ein einziges Script-Tag: Du findest es im Verwaltungsbereich unter »Einstellungen → Widget für deine Website« zum Kopieren. Füge es in deine Website ein — fertig, es ist kein weiterer Code und keine Konfiguration nötig.",
      "Das Widget übernimmt Branding und Inhalte automatisch von deinem Hilfezentrum. Die Nutzung zählt auf die Credits und aktiven Nutzer deiner Instanz — genau wie das Hilfezentrum selbst.",
      "Mit dem Schalter »Widget auch im eigenen Hilfezentrum anzeigen« (gleiche Einstellungs-Karte) erscheint der Hilfe-Button zusätzlich auf den öffentlichen Seiten deines Hilfezentrums. Praktisch als zweiter Einstieg neben der Suche — und um selbst zu sehen, wie das Widget für deine Besucher aussieht. In diesem Hilfezentrum ist der Schalter aktiv: Der Button unten rechts ist genau das Widget, das du einbauen kannst.",
    ],
    related: ["ki-antworten", "credits-und-limits", "branding-anpassen"],
  },
  {
    slug: "support-tickets",
    title: "Support-Anfragen & Inbox",
    category: "Support",
    min: 2,
    body: [
      "Unter jeder KI-Antwort — auch wenn die KI nichts Passendes gefunden hat — können Nutzer über »Etwas stimmt nicht?« ein Support-Anliegen einreichen: mit Beschreibung und optionaler E-Mail-Adresse für deine Rückmeldung.",
      "Jede Anfrage landet als Ticket in deiner Inbox im Verwaltungsbereich. Dort siehst du die ursprüngliche Frage an die KI als Kontext, markierst Tickets als erledigt oder löschst sie.",
      "Hinterlegst du in den Einstellungen eine Support-E-Mail-Adresse, bekommst du jedes Ticket zusätzlich per E-Mail zugestellt. Ohne Adresse sammelt die Inbox alle Anfragen — verloren geht nichts.",
    ],
    related: ["ki-antworten"],
  },
  {
    slug: "mehrsprachige-artikel",
    title: "Mehrsprachige Artikel & KI-Übersetzung",
    category: "Inhalte pflegen",
    min: 2,
    body: [
      "Jeder Artikel kann in mehreren Sprachen existieren — als verbundenes Set: Jede Sprachfassung hat ihren eigenen Link, ihren eigenen Entwurfs-/Veröffentlicht-Status und erscheint im Hilfezentrum in der passenden Sprache. Besucher wechseln auf der Artikelseite per Klick zwischen den verfügbaren Sprachen.",
      "Im Artikel-Editor findest du den Abschnitt »Übersetzungen«. Dort legst du eine fehlende Sprachfassung an: entweder manuell (der Originaltext wird als Startpunkt kopiert) oder per KI-Übersetzung — sie überträgt Titel, Text samt Formatierung, Links und Bild-Beschreibungen und kopiert die Bilder mit. Eine KI-Übersetzung kostet 50 Credits und wird nur bei Erfolg berechnet.",
      "Übersetzungen starten immer als Entwurf: Du prüfst den Text und veröffentlichst ihn bewusst. Die KI-Antworten nutzen automatisch die Sprachfassung, die zur Sprache der Frage passt.",
      "In der Artikel-Liste erscheint ein Set als EIN Eintrag: Die Zeile gehört dem Original, weitere Sprachen hängen als Kürzel daran — ein Klick auf »EN« öffnet die englische Fassung. Auch im Editor wechselst du oben per Sprach-Kürzel zwischen den Fassungen.",
      "Änderst du das Original, nachdem übersetzt wurde, markieren Liste und Editor die Übersetzung als möglicherweise veraltet — so übersiehst du keine nachzuziehende Übersetzung. Übersetzen und Wechseln sind erst möglich, wenn der aktuelle Stand veröffentlicht ist (ungespeicherte Änderungen gehen so nie verloren).",
    ],
    related: ["artikel-veroeffentlichen", "credits-und-limits"],
  },
  {
    slug: "videos-einbinden",
    title: "Videos in Artikeln (YouTube)",
    category: "Inhalte pflegen",
    min: 1,
    body: [
      "Binde YouTube-Videos direkt im Artikel ein: Füge einen Video-Block hinzu und trage dort den YouTube-Link, Titel und Beschreibung ein. Der Block zeigt das Video sofort so, wie es später im Artikel erscheint — abgespielt wird erst nach einem Klick (datensparsamer YouTube-Modus).",
      "Die Beschreibung ist Pflicht — sie dient als Alternativtext und fließt als Kontext in die KI-Antworten ein: Die KI kann so auch auf Inhalte verweisen, die im Video erklärt werden.",
      "Damit die Beschreibung dafür aussagekräftig genug ist, gibt es »Inhalt automatisch erfassen« (20 Credits): Der Titel wird direkt von YouTube geholt, und aus dem Transkript des Videos erstellt die KI Titel und Beschreibung. YouTube erlaubt keinen automatischen Transkript-Abruf — der Editor zeigt deshalb ein Feld, in das du das Transkript einfügst (auf YouTube unter dem Video: »…« → »Transkript anzeigen« → kopieren). Ohne Transkript wird bewusst KEINE Beschreibung erfunden und nichts berechnet.",
      "Bei Bildern bleibt die Beschreibung Handarbeit: Dort muss stehen, was hervorgehoben ist oder wohin geklickt wird — das steht in keinem Transkript.",
      "Änderst du Videos, greifen sie wie Textänderungen erst mit dem Veröffentlichen des Artikels.",
    ],
    related: ["artikel-veroeffentlichen", "ki-antworten"],
  },
  {
    slug: "ki-client-verbinden",
    title: "Eigenen KI-Client verbinden (MCP)",
    category: "Inhalte pflegen",
    min: 4,
    body: [
      "Du kannst dein Hilfezentrum an deinen eigenen KI-Client anbinden — Claude Code, Claude Desktop, Cursor oder einen selbst gebauten Agenten. Danach pflegst du Artikel im Gespräch: »Lies unser Changelog und leg mir daraus Entwürfe an« oder »Übernimm unsere alte Dokumentation von dieser Adresse«. Die Schnittstelle dafür heißt MCP (Model Context Protocol).",
      "Der entscheidende Punkt: Die KI-Leistung erbringt DEIN Client in deinem eigenen KI-Abo. Bei uns kommen nur fertige, geprüfte Schreibbefehle an — Schreiben über MCP verbraucht deshalb keine Credits.",
      "So verbindest du: Gehe im Verwaltungsbereich auf »Zugriffs-Schlüssel«. Dort stehen deine MCP-Adresse und ein fertiger Befehl zum Kopieren. Lege einen Schlüssel an, setze ihn in den Befehl ein — fertig. Jedes Hilfezentrum hat seine eigene Adresse; ein Schlüssel gilt immer nur für genau dieses eine.",
      "Der Schlüssel entscheidet, was die KI darf. Beim Anlegen wählst du die Rechte einzeln aus, jeweils mit Klartext daneben, was sie bedeuten. Voreingestellt ist bewusst zahm: lesen und Entwürfe schreiben. Alles, was nach außen wirkt, musst du aktiv einschalten.",
      {
        type: "accordion",
        title: "Was kann eine KI mit welchem Recht?",
        text:
          "Lesen: Artikel, Entwürfe, Kategorien, Übersetzungen, Statistiken, Einstellungen — dazu die Schreib-Konventionen deines Hilfezentrums, damit die KI gültige Bausteine baut statt zu raten.\n\nArtikel schreiben und ändern: Artikel anlegen (immer als ENTWURF), Texte, Tabellen und Hinweisboxen ändern, ganze Seiten von einer Adresse übernehmen, Bilder hinzufügen, ihre Beschreibungen nachbessern und Videos mit Titel und Beschreibung setzen. Nichts davon wird öffentlich.\n\nVeröffentlichen: macht Artikel sofort für alle Besucher sichtbar — standardmäßig AUS.\n\nChangelog und Roadmap pflegen: hier gibt es keinen Entwurf, Änderungen sind sofort öffentlich.\n\nLöschen: nur mit einer ausdrücklichen Bestätigung im KI-Gespräch (siehe unten) — standardmäßig AUS.",
      },
      "Der Klartext-Schlüssel wird genau einmal angezeigt, direkt nach dem Anlegen. Danach siehst du in der Liste nur noch, wofür er gilt, wann er zuletzt benutzt wurde und wann er abläuft (standardmäßig nach 90 Tagen). Du kannst ihn jederzeit mit einem Klick widerrufen — er wirkt sofort nicht mehr.",
      "Löschen ist absichtlich umständlich: Der erste Löschbefehl löscht nichts, sondern liefert eine Zusammenfassung dessen, was verschwinden würde, plus ein kurzlebiges Bestätigungs-Token. Erst ein zweiter Aufruf mit diesem Token löscht wirklich. Eine KI kann also nicht in einem Schritt Inhalte vernichten.",
      "Nicht per MCP erreichbar sind bewusst: Team und Rollen, Eigentümerschaft, Rechtstexte, eigene Domain, Plan und Bezahlung sowie die Schlüsselverwaltung selbst. Diese Flächen bleiben Mensch, Anmeldung und Zwei-Faktor-Authentifizierung vorbehalten — ein geleakter Schlüssel soll Inhalte gefährden können, niemals dein Konto.",
      "Tipp: Lege lieber zwei enge Schlüssel an als einen Generalschlüssel — etwa einen reinen Lese-Schlüssel für Recherche und Auswertungen und einen Schreib-Schlüssel ohne Veröffentlichen für die Redaktion.",
    ],
    related: ["inhalte-importieren-exportieren", "artikel-veroeffentlichen"],
  },
  {
    slug: "suchmaschinen-sichtbarkeit",
    title: "Suchmaschinen & Sichtbarkeit",
    category: "Sichtbarkeit",
    min: 2,
    body: [
      "Dein Hilfezentrum ist von Haus aus für Suchmaschinen optimiert: Jeder veröffentlichte Artikel hat eine eigene, servergerenderte Seite mit sauberen Meta-Daten, und deine Instanz liefert automatisch eine eigene Sitemap und robots.txt — du musst nichts einrichten.",
      "Neue Hilfezentren werden zusätzlich zentral bei Google angemeldet, damit sie auch ohne bestehende Verlinkung gefunden werden.",
      "Soll dein Hilfezentrum nicht öffentlich auffindbar sein — etwa für interne Dokumentation — schaltest du die Indexierung ab: entweder direkt beim Erstellen oder später als Owner in den Einstellungen unter »Suchmaschinen«. Bereits gelistete Seiten verschwinden dann nach dem nächsten Crawl.",
    ],
    related: ["hilfezentrum-erstellen", "artikel-veroeffentlichen"],
  },
];

/** Roadmap: die nächsten Bausteine (nur real Geplantes, kein Wunschkonzert). */
const ROADMAP = [
  { title: "Bezahlpläne & Upgrade (Self-Service)", status: "planned", sort: 1 },
  { title: "Voice-Bot-Anbindung (API für Sprachassistenten)", status: "planned", sort: 2 },
];

/** Changelog: nur tatsächlich ausgelieferte Meilensteine (neueste zuerst gerendert). */
// KUNDEN-SICHT der Änderungen (die technische Liste ist CHANGELOG.md).
// `version`/`level` sind optional; für UNSERE Instanz gilt: jedes Minor-Release
// bekommt hier einen Eintrag mit Versionsnummer (docs/versioning.md).
const CHANGELOG = [
  {
    title: "Changelog & Roadmap selbst pflegen — mit Versionsnummer",
    description:
      "Changelog-Einträge und Roadmap-Punkte lassen sich jetzt im Verwaltungsbereich pflegen; jeder Eintrag kann eine eigene Versionsnummer und die Art des Updates tragen. Auch per MCP aus einem KI-Client heraus änderbar.",
    at: RELEASE_0_2_0 + 60,
    version: "0.2.0",
    level: "minor",
  },
  {
    title: "Neue Bausteine: aufklappbare Abschnitte, Buttons, Dateien",
    description:
      "Artikel können aufklappbare Abschnitte, Aktions-Buttons, Trennlinien und Datei-Anhänge (PDF, CSV, Office) enthalten. Lange Artikel bekommen automatisch ein Inhaltsverzeichnis, jede Überschrift ist einzeln teilbar.",
    at: RELEASE_0_2_0,
    version: "0.2.0",
    level: "minor",
  },
  { title: "YouTube-Videos in Artikeln", description: "Videos mit Pflicht-Beschreibung neben dem Artikel — Klick-zum-Abspielen, Inhalte fließen in die KI-Antworten ein.", at: BASE + 990 },
  { title: "Mehrsprachige Artikel & KI-Übersetzung", description: "Artikel als Sprach-Sets mit eigenem Link je Sprache; KI-Übersetzung inklusive Formatierung, Links und Bildern (50 Credits).", at: BASE + 960 },
  { title: "Rich-Text-Editor, Bilder & Import/Export", description: "Editor mit Überschriften, Listen und Links; Bilder mit Pflicht-Beschreibung; Export als JSON, Import aus JSON und Markdown.", at: BASE + 930 },
  { title: "Gespeicherte Antworten im Konto + Veraltet-Erkennung", description: "KI-Antworten geräteübergreifend speichern; bei geänderten Quellen werden sie als veraltet markiert.", at: BASE + 915 },
  { title: "Website-Widget", description: "KI-Hilfe als einbettbarer Chat auf der eigenen Website — ein Script-Tag, Branding automatisch.", at: BASE + 900 },
  { title: "Support-Anfragen & Inbox", description: "»Etwas stimmt nicht?« unter KI-Antworten erzeugt Tickets — mit Inbox im Admin und optionaler E-Mail-Zustellung.", at: BASE + 850 },
  { title: "Feedback & Quellen-Statistik", description: "Hilfreich-Quote zu Artikeln und KI-Antworten plus »Häufigste Quellen« in der Statistik.", at: BASE + 800 },
  { title: "Suchmaschinen-Steuerung", description: "Automatische Sitemap & robots.txt je Hilfezentrum; Indexierung pro Instanz abschaltbar.", at: BASE + 750 },
  { title: "KI-Antworten & Credits", description: "Dynamische Hilfeartikel aus den eigenen Inhalten, mit Quellen, Grounding und Credit-Metering.", at: BASE + 700 },
  { title: "Hilfezentrum & Artikel-Verwaltung", description: "Artikel anlegen, in Kategorien pflegen und veröffentlichen; öffentliche Artikelseiten je Hilfezentrum.", at: BASE + 500 },
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

// Roadmap ist seed-autoritativ (kein Admin-Editing) → alte Zeilen ersetzen.
out.push(`DELETE FROM roadmap_items WHERE tenant_id = '${TENANT}';`);
ROADMAP.forEach((r, i) => {
  const id = "op_rm_" + (i + 1);
  out.push(
    `INSERT INTO roadmap_items (id,tenant_id,title,status,sort) VALUES ('${id}','${TENANT}','${esc(r.title)}','${r.status}',${r.sort})\n` +
      `ON CONFLICT(tenant_id,id) DO UPDATE SET title=excluded.title,status=excluded.status,sort=excluded.sort;`,
  );
});

// Changelog ist seed-autoritativ → alte Zeilen ersetzen.
out.push(`DELETE FROM changelog_entries WHERE tenant_id = '${TENANT}';`);
CHANGELOG.forEach((c, i) => {
  const id = "op_cl_" + (i + 1);
  // version/level (0030): unsere eigene Instanz führt die Produktversion mit —
  // Regel: jedes MINOR-Release erscheint hier (docs/versioning.md).
  const version = c.version ? `'${esc(c.version)}'` : "NULL";
  const level = c.level ? `'${c.level}'` : "NULL";
  out.push(
    `INSERT INTO changelog_entries (id,tenant_id,published_at,title,description,version,level) VALUES ('${id}','${TENANT}',${c.at},'${esc(c.title)}','${esc(c.description)}',${version},${level})\n` +
      `ON CONFLICT(tenant_id,id) DO UPDATE SET published_at=excluded.published_at,title=excluded.title,description=excluded.description,version=excluded.version,level=excluded.level;`,
  );
});

console.log(out.join("\n\n"));
