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
const RELEASE_0_3_0 = 1789394400; // 2026-09-15
const RELEASE_0_4_0 = 1789480800; // 2026-09-16
const RELEASE_0_4_1 = 1789567200; // 2026-09-17
const RELEASE_0_5_0 = 1789740000; // 2026-09-18
const RELEASE_0_5_1 = 1789750000; // 2026-09-18

/** Artikel: nur real funktionierende Fähigkeiten. body = Absatz-Array. related = Slugs. */
const ARTICLES = [
  {
    slug: "was-ist-hallofhelp",
    icon: "sparkle",
    title: "Was ist HallofHelp?",
    category: "Erste Schritte",
    min: 2,
    body: [
      "HallofHelp ist ein White-Label-Hilfezentrum: Du richtest unter deiner eigenen Subdomain ein Hilfezentrum ein, versiehst es mit deinem Logo und deinen Farben und füllst es mit Artikeln.",
      "Deine Nutzer öffnen das Hilfezentrum, stöbern nach Kategorien und durchsuchen die Artikel. Auf der Startseite empfängt sie ein KI-Eingabefeld — darunter kannst du Einstiegs-Karten zeigen, die auf deine wichtigsten Artikel führen. Die Reihenfolge der Leiste links bestimmst du selbst. Zusätzlich kannst du eine Roadmap und einen Changelog pflegen, um Geplantes und Neuerungen transparent zu machen.",
      "Die Roadmap kennt vier Zustände: »Angefragt« für Kundenwünsche, die du gesammelt, aber noch nicht zugesagt hast, dann »Geplant«, »In Arbeit« und »Geliefert«. Der Unterschied zwischen angefragt und geplant ist wichtig — er entscheidet, ob ein Eintrag eine Sammlung oder ein Versprechen ist.",
      "Jedes Hilfezentrum ist strikt getrennt: eigene Subdomain, eigene Inhalte, eigenes Team und eigene Zugriffsrechte. Kein Kunde sieht die Daten eines anderen.",
      "Dieses Hilfezentrum, das du gerade liest, ist selbst mit HallofHelp gebaut — es ist unser lebendes Beispiel dafür, wie das Produkt genutzt wird.",
    ],
    related: ["hilfezentrum-erstellen", "artikel-veroeffentlichen", "navigation-und-einstieg"],
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
    slug: "suche-nutzen",
    icon: "search",
    title: "Suchen & finden",
    category: "Erste Schritte",
    min: 2,
    body: [
      "Oben links in der Leiste steht die Suche. Sie durchsucht nicht nur Überschriften, sondern auch den INHALT deiner Artikel — wer sich an eine Formulierung mitten im Text erinnert, findet sie damit.",
      "Zu jedem Treffer siehst du den Titel, die Kategorie und einen Ausschnitt aus dem Text mit markierter Fundstelle. So erkennst du vor dem Klick, warum ein Artikel gefunden wurde.",
      "## Wie sie sucht",
      "Mehrere Wörter wirken als UND: »sprache kontakt« findet nur Artikel, die beides enthalten. Groß- und Kleinschreibung ist egal, Umlaute ebenso — »ubersetzung« findet »Übersetzung«.",
      "Die Rangfolge ist fest: Ein Treffer im Titel steht vor einem in der Kategorie, der vor einem im Fließtext. Und ein Wort am Anfang eines Begriffs zählt mehr als eines mitten drin.",
      "## Wo ihre Grenze ist",
      "Die Suche arbeitet WÖRTLICH. Sie kennt keine Wortstämme, keine Synonyme und verzeiht keine Tippfehler — »Sprachen« findet »Sprache« nur über den gemeinsamen Anfang.",
      "Das ist Absicht: Wörtlich heißt vorhersagbar. Für die andere Art zu suchen gibt es daneben das KI-Feld — es versteht die Frage, auch wenn kein Wort davon im Artikel steht. Zwei Wege, zwei Stärken.",
      "## Frage-Vorschläge",
      "Unter der KI-Eingabe kannst du bis zu vier Beispielfragen zeigen. Sie sind das Erste, was jemand liest, der noch nicht weiß, was er fragen soll — und damit eine Aussage darüber, wofür dein Hilfezentrum da ist.",
      "Gepflegt werden sie unter »Navigation«. Schreib sie so, wie ein Leser fragen würde, und nur das, was dein Hilfezentrum wirklich beantworten kann. Keine Vorschläge ist auch in Ordnung: Dann steht die Eingabe schlicht da.",
    ],
    related: ["ki-antworten", "navigation-und-einstieg"],
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
    icon: "key",
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
    icon: "lock",
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
      "Sollen am Ende eines Artikels mehrere Verweise nebeneinander stehen — »Weitere Features«, »Passende Integrationen« —, nimm das »Verweis-Gitter«: bis zu zwölf Karten, jede mit Ziel-Artikel, eigenem Titel, Beschreibung und optionalem Tag. Auf großen Bildschirmen stehen sie zweispaltig, auf dem Handy untereinander. Jede Karte wird einzeln indexiert, die KI kann also gezielt auf einen der verlinkten Artikel verweisen.",
      "Aufklappbare Abschnitte bleiben für die KI-Suche sichtbar: Der Inhalt wird indexiert, auch wenn er beim Lesen erst nach einem Klick erscheint. Ein Beispiel siehst du direkt hier:",
      {
        type: "accordion",
        title: "Wann nehme ich »Zurückziehen« und wann »Entwurf speichern«?",
        text:
          "»Entwurf speichern« ist für Artikel, die noch nie veröffentlicht waren — sie bleiben unsichtbar, bis du sie veröffentlichst.\n\n»Zurückziehen« nimmst du für einen bereits veröffentlichten Artikel, den du in Ruhe umbauen willst: Er verschwindet aus dem Hilfezentrum, bleibt aber mit allen Inhalten bestehen.",
      },
      "Mit »Zurückziehen« wird ein Artikel wieder unsichtbar, ohne gelöscht zu werden. Jede Änderung wird als Version gesichert, sodass der Verlauf nachvollziehbar bleibt.",
      "Beim Bearbeiten hast du zwei Wege: »Entwurf speichern« sichert deinen Stand, ohne ihn zu veröffentlichen — du kannst später weiterarbeiten und den Artikel erst dann online stellen. »Veröffentlichen« macht ihn sichtbar. Bei einem bereits veröffentlichten Artikel sind gespeicherte Änderungen sofort live; willst du in Ruhe umbauen, ziehe ihn vorher mit »Zurückziehen« offline.",
      "Solltest du eine Seite mit ungespeicherten Änderungen verlassen wollen — etwa durch einen Klick auf einen Link — fragt der Verwaltungsbereich nach: hierbleiben, speichern und weiter, oder verwerfen und weiter. Das gilt überall, wo du etwas pflegst, nicht nur im Artikel-Editor. Beim Schließen des Tabs oder beim Neuladen warnt der Browser mit seinem eigenen Hinweis — dort sind eigene Knöpfe technisch nicht möglich.",
      "Endgültig löschen kannst du einen Artikel im Editor (Bearbeiten-Modus, »Artikel löschen«) — nach einer Bestätigung werden auch seine Bilder und der Such-Index-Eintrag entfernt. Andere Sprachfassungen bleiben bestehen.",
      "Jede Überschrift in einem veröffentlichten Artikel ist einzeln verlinkbar: Beim Überfahren erscheint ein kleines Link-Symbol — ein Klick kopiert die Adresse direkt zu diesem Abschnitt, ideal um Kunden auf genau eine Stelle zu verweisen.",
      "Ab drei Überschriften zeigt der Artikel zusätzlich ein Inhaltsverzeichnis — auf großen Bildschirmen rechts neben dem Text, auf dem Handy über dem Artikel. Es entsteht automatisch aus deinen Überschriften; du musst nichts pflegen.",
      "Die Reihenfolge von Artikeln und Kategorien in der linken Leiste bestimmst du selbst — unter »Navigation« im Verwaltungsbereich. Siehe »Navigation & Einstieg ordnen«.",
    ],
    related: ["was-ist-hallofhelp"],
  },
  {
    slug: "navigation-und-einstieg",
    title: "Navigation & Einstieg ordnen",
    category: "Inhalte pflegen",
    min: 3,
    body: [
      "Ein Hilfezentrum liest man in einer Reihenfolge — »Erste Schritte« gehört nach oben, Spezialfälle nach unten. Unter »Navigation« im Verwaltungsbereich legst du diese Reihenfolge fest und bestimmst, was Besucher auf der Startseite als Einstieg angeboten bekommen.",
      "## Reihenfolge der Artikel",
      "Zieh Artikel mit der Maus an ihren Platz, oder setze den Fokus mit der Tabulatortaste auf einen Eintrag und verschiebe ihn mit Pfeil hoch und Pfeil runter. Beides funktioniert gleichwertig — die Tastaturbedienung ist kein Notbehelf.",
      "Kategorien verschiebst du als Ganzes: Der Kategoriename ist selbst ein Griff, ihn zu ziehen nimmt alle seine Artikel mit. Eine Kategorie hat keine eigene Position — sie steht dort, wo ihr erster Artikel steht. Deshalb genügt eine einzige Liste für beide Ebenen.",
      "Artikel bleiben beim Sortieren in ihrer Kategorie. Willst du einen Artikel in eine andere Kategorie verschieben, ändere die Kategorie im Artikel selbst — das ist eine inhaltliche Entscheidung und gehört in den Editor, nicht in die Sortierung.",
      "Entwürfe stehen mit in der Liste, erscheinen im Hilfezentrum aber erst nach dem Veröffentlichen. Das ist Absicht: So bestimmst du den Platz eines Artikels schon vorher, statt ihn nach dem Veröffentlichen an zufälliger Stelle wiederzufinden.",
      "## Einstiegs-Karten auf der Startseite",
      "Unter der KI-Eingabe kannst du bis zu sechs Karten anzeigen — der gesetzte erste Schritt für alle, die noch nicht wissen, wonach sie fragen sollen. Jede Karte hat einen Titel, wahlweise eine kurze Beschreibung und ein Ziel.",
      "Vier Ziele stehen zur Wahl: ein veröffentlichter Artikel, die Roadmap, der Changelog oder eine externe https-Adresse (etwa deine Statusseite oder Community). Externe Karten öffnen in einem neuen Tab und sind mit einem Symbol gekennzeichnet.",
      "Als Artikel-Ziel stehen nur VERÖFFENTLICHTE Artikel zur Auswahl. Eine Karte, die auf einen Entwurf zeigt, wäre für jeden Besucher ein toter Link.",
      {
        type: "accordion",
        title: "Warum sind Einstiegs-Karten sofort öffentlich?",
        text:
          "Wie Changelog und Roadmap haben die Karten keinen Entwurfszustand: Was du speicherst, steht sofort auf der Startseite.\n\nDer Grund ist ihr Zweck — sie sind Navigation, kein Inhalt. Eine halb fertige Karte hilft niemandem, und ein Entwurfszustand für ein Element, das nur aus Titel und Ziel besteht, wäre mehr Verwaltung als Nutzen.",
      },
      "## Symbol je Artikel",
      "Vor jedem Artikel kann ein Symbol stehen — oder keins, und keins ist der Standard. Das ist Absicht: Ein Zeichen, das vor jeder Zeile gleich aussieht, trägt keine Information und kostet nur Platz.",
      "Im Editor wählst du unter »Symbol in der Navigation« aus einem festen Satz. Alle Symbole stammen aus derselben Familie, damit die Leiste ruhig bleibt. Setze eines nur dort, wo es beim Überfliegen wirklich hilft — etwa ein Schlüssel bei »Passwort zurücksetzen«.",
      "Hat kein Artikel ein Symbol, fällt die Spalte ganz weg und die Titel stehen bündig links. Sobald ein Artikel eines hat, wird die Spalte für alle freigehalten, damit die Titel nicht versetzt stehen.",
      "## Beta-Kennzeichnung in der Leiste",
      "Beschreibt ein Artikel eine Funktion, die noch in der Beta ist, gib ihm im Editor ein Flag mit dem Text »Beta«. Das Badge erscheint dann NEBEN dem Artikel in der linken Leiste — nicht erst im Artikel selbst.",
      "Damit sieht ein Leser schon vor dem Klick, worauf er sich einlässt. Für die Farbe stehen sechs Töne zur Wahl. Für »Beta« nimm »Blau (Hinweis)«: Es sagt »hier ist noch Bewegung drin«, ohne zu warnen. Gelb hebst du dir für echte Vorsicht auf.",
      "## Alles davon per KI",
      "Reihenfolge, Karten und Flags lassen sich auch über einen angebundenen KI-Client setzen. Siehe »Eigenen KI-Client verbinden (MCP)«.",
    ],
    related: ["artikel-veroeffentlichen", "ki-client-verbinden"],
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
      "Das Favicon ist mehr als das Zeichen im Browser-Tab: Es erscheint auch unten in der Zeile mit Impressum, Datenschutz und AGB. Dort ist der Platz ein kleines Quadrat — ein breites Logo würde darin untergehen, deshalb steht da bewusst das Favicon. Ohne eigenes Favicon bleibt die Zeile schlicht ohne Zeichen.",
      "In den Einstellungen lädst du dein Logo hoch (PNG, JPEG oder WebP, maximal 1 MB) und legst deine Primär- und Akzentfarbe fest — jede Karte speichert direkt beim Klick.",
      "Optional hinterlegst du ein zweites Logo für den dunklen Modus: Besucher mit Dark Mode sehen dann automatisch die passende Variante. Ohne dunkles Logo wird überall das helle gezeigt.",
      "Das Favicon — das kleine Bild im Browser-Tab und in Lesezeichen — übernimmt automatisch dein helles Logo, sobald du eines hochgeladen hast. Du musst dafür nichts tun. Weil ein breites Logo im Tab winzig wird, kannst du zusätzlich ein eigenes Favicon hinterlegen: ein quadratisches Emblem, mindestens 64×64, als PNG, JPEG, WebP oder ICO. Es hat Vorrang vor dem Logo.",
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
    icon: "card",
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
    slug: "kontaktseite-einrichten",
    icon: "inbox",
    title: "Kontaktseite einrichten",
    category: "Support",
    min: 2,
    body: [
      "Wenn weder die Artikel noch die KI-Antwort weiterhelfen, brauchen deine Nutzer einen Ausweg. Dafür gibt es eine Kontaktseite mit den Wegen, die DU anbietest — und einen Eintrag »Kontakt« ganz unten in der Navigation.",
      "Eingerichtet wird sie unter »Navigation« im Verwaltungsbereich, Abschnitt »Kontaktwege«. Jeder Weg ist eine Karte; bis zu sechs sind möglich.",
      "## Die drei Arten",
      "**E-Mail:** Adresse eintragen. Die Karte wird zum Klickziel, das beim Nutzer das Mailprogramm öffnet.",
      "**Telefon:** Rufnummer eintragen. Auf dem Handy wählt ein Tippen direkt. Schreibweise ist frei — »+49 30 123456« und »(030) 123-456« sind beide in Ordnung.",
      "**Kontaktformular:** Die Karte enthält ein offenes Formular. Abgeschickte Nachrichten landen als Ticket in deinem Postfach — derselbe Weg wie der Meldelink unter den KI-Antworten.",
      "Zu jeder Karte gehört eine Überschrift und wahlweise eine kurze Beschreibung. Nutze sie für Erwartungen: »Antwort meist am selben Werktag« beugt Nachfragen vor.",
      {
        type: "accordion",
        title: "Warum gibt es keinen Schalter »Kontaktseite anzeigen«?",
        text:
          "Seite und Navigations-Eintrag erscheinen genau dann, wenn mindestens ein Kontaktweg gepflegt ist. Pflegst du keinen, gibt es beides nicht.\n\nEin zusätzlicher Schalter wäre eine zweite Wahrheit neben der Liste: »eingeschaltet, aber leer« ergäbe eine Kontaktseite, die keinen Kontakt anbietet — und die ruft jemand auf, der ohnehin schon nicht weiterkommt.",
      },
      "Änderungen sind sofort öffentlich; einen Entwurfszustand gibt es hier nicht.",
      "## Per KI-Client pflegen",
      "Die Kontaktwege lassen sich auch über einen angebundenen KI-Client pflegen — lesen und setzen. Gesetzt wird dabei immer der GANZE Satz: Was die KI übergibt, ersetzt den bisherigen Stand, und eine leere Liste entfernt Seite und Navigations-Eintrag wieder. Welche Werkzeuge es dafür gibt, liest dein Client selbst aus dem Hilfezentrum aus; du musst ihm nichts davon nennen.",
      "Weil die Wege sofort öffentlich sind, hängt das Schreiben am Recht »Changelog und Roadmap pflegen«, nicht am reinen Schreibrecht für Artikel. Siehe »Eigenen KI-Client verbinden (MCP)«.",
    ],
    related: ["navigation-und-einstieg", "support-tickets"],
  },
  {
    slug: "kopf-knoepfe-und-widget",
    icon: "grid",
    title: "Kopf-Knöpfe & Widget gestalten",
    category: "Branding",
    min: 3,
    body: [
      "Zwei Flächen tragen deine Handschrift nach außen: die Knöpfe oben im Kopf des Hilfezentrums und der Starter des Widgets auf deiner Website. Beide nutzen dieselben vier Varianten — einmal verstanden, überall gültig.",
      "## Die vier Varianten",
      "**Ghost:** nur Text, kein Rahmen, keine Fläche. Für Nebensächliches. **Outlined:** Rahmen, durchsichtige Fläche. Der ruhige Standard. **Filled:** kräftige Fläche in Textfarbe, höchster Kontrast. **Colored:** Fläche in DEINER Markenfarbe.",
      "Eine freie Farbe gibt es bewusst nicht. »Colored« nimmt die Farbe, die du im Branding gesetzt hast — die ist bereits auf Lesbarkeit geprüft. Ein zusätzlicher Farbwähler könnte einen Knopf erzeugen, dessen Schrift auf der eigenen Fläche verschwindet.",
      "## Knöpfe im Kopf",
      "Unter »Navigation« legst du bis zu drei Knöpfe an: Beschriftung, wahlweise ein Symbol, ein Ziel und die Variante. Gut für die eine Handlung, die überall erreichbar sein soll — Termin buchen, Statusseite, Demo anfragen.",
      "Als Ziel sind vollständige https-Adressen erlaubt oder instanz-interne Pfade wie »/contact«. Unverschlüsselte http-Adressen nehmen wir nicht an: Der Knopf steht im Kopf jeder Seite.",
      "Die Vorschau in der Pflegeoberfläche zeigt den Knopf so, wie er später aussieht — das sagt mehr als der Name der Variante.",
      "## Widget gestalten",
      "In den Einstellungen wählst du dieselben vier Varianten für den Starter, dazu eine eigene Beschriftung. Ohne Beschriftung bleibt er ein runder Knopf, mit wird eine Pille daraus.",
      "Beides — die Kopf-Knöpfe und Variante samt Beschriftung des Widgets — lässt sich auch über einen angebundenen KI-Client setzen. Die Symbole bleiben bewusst bei dir: Das sind Bilddateien, die du hochlädst.",
      "Für den geschlossenen und den geöffneten Zustand kannst du je ein eigenes Symbol hochladen. Im Kopf des Widgets erscheint automatisch dein Logo.",
      {
        type: "accordion",
        title: "Warum nehmen wir kein SVG für die Symbole?",
        text:
          "SVG ist kein Bild im engeren Sinn, sondern ein Dokument — es kann Skripte und Ereignis-Handler enthalten. Von unserer eigenen Adresse ausgeliefert wäre das ein Einfallstor.\n\nFür ein Symbol in FESTER Größe bringt Vektor ohnehin nichts, was doppelte Auflösung nicht auch kann: Lade dein Zeichen als PNG oder WebP mit 96×96 Punkten hoch, dann ist auch auf feinen Bildschirmen kein Unterschied zu sehen.",
      },
    ],
    related: ["branding-anpassen", "widget-einbinden"],
  },
  {
    slug: "verstaendnis-hinweise",
    icon: "info",
    title: "„Ich verstehe etwas nicht“",
    category: "Support",
    min: 2,
    body: [
      "Manchmal ist ein Artikel nicht falsch, sondern nur unklar — und zwar an einer bestimmten Stelle. Dafür gibt es unter jedem Artikel den Knopf »Ich verstehe etwas nicht«.",
      "Der Leser schaltet damit einen Modus ein: Eine kurze Erklärung, dann wird der Zeiger zum Fadenkreuz und jeder Absatz, jedes Bild und jede Tabelle bekommt einen Rahmen. Ein Klick auf die unklare Stelle öffnet ein Feld für den Hinweis. Danach kann er freiwillig eine E-Mail-Adresse hinterlassen — oder anonym absenden.",
      "## Was du davon hast",
      "Der Hinweis kommt MIT der Stelle bei dir an: Du siehst, welcher Artikel gemeint ist und welchen Absatz der Leser angeklickt hat, samt dem Text dieser Stelle. »Irgendwo in der Mitte war etwas seltsam« hilft niemandem — das hier schon.",
      "Die Hinweise landen im selben Postfach wie die Support-Anfragen, unter »Probleme«, dort gekennzeichnet als »Artikel unklar«.",
      "## Abgrenzung zu »Etwas stimmt nicht?«",
      "»Etwas stimmt nicht?« steht unter einer KI-ANTWORT und meldet, dass die Antwort nicht taugte. »Ich verstehe etwas nicht« steht am ARTIKEL und meldet eine Stelle im Text. Anderer Anlass, anderer Kontext — aber dasselbe Postfach, damit du nur einen Ort im Blick behalten musst.",
      "## Abschalten",
      "Unter »Einstellungen« kannst du den Modus ausschalten. Standardmäßig ist er an. Aus heißt wirklich aus: Der Knopf verschwindet, und auch ein direkter Aufruf der Schnittstelle wird abgewiesen.",
      "## Wenn eine KI etwas meldet",
      "Auch ein angebundener KI-Client kann eine unklare oder widersprüchliche Stelle melden, während er deine Artikel liest. Solche Meldungen erscheinen im Postfach als »KI-Hinweis« — getrennt von den Hinweisen echter Leser.",
      "Diese Trennung ist wichtig: Ein Mensch, der meldet, dass er nicht weiterkommt, ist selten und wertvoll. Eine Maschine kann davon beliebig viele erzeugen. Lägen beide im selben Topf, würde das seltene Signal darin untergehen.",
      {
        type: "accordion",
        title: "Welche Grenzen gelten für KI-Meldungen?",
        text:
          "Höchstens 20 Meldungen pro Tag für dein ganzes Hilfezentrum — gezählt wird je Instanz, nicht je Zugriffs-Schlüssel.\n\nZu derselben Stelle gibt es nur EINE offene Meldung. Ein zweiter Versuch legt nichts an, sondern bekommt die Antwort, dass es bereits bekannt ist.\n\nEin Verbesserungsvorschlag ist Pflicht: »Das ist unklar« allein wird abgelehnt. Wer meldet, sagt auch, wie es besser hieße — sonst verlagert die Meldung nur Arbeit.\n\nGemeldet werden können ausschließlich VERÖFFENTLICHTE Artikel. Und eine Meldung ändert nie den Artikel — sie landet im Postfach, entschieden wird von dir.",
      },
    ],
    related: ["support-tickets", "artikel-veroeffentlichen"],
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
      "Beides geht auch aus einem verbundenen KI-Client heraus: Dein Client kann eine einzelne Videobeschreibung ändern, ohne die anderen Videos anzufassen, und aus einem eingefügten Transkript Titel und Beschreibung erzeugen lassen. Ohne Transkript wird auch dort nichts erfunden. Bildbeschreibungen kann er sich ansehen und gleich stapelweise nachbessern — siehe »Eigenen KI-Client verbinden (MCP)«.",
      "Änderst du Videos, greifen sie wie Textänderungen erst mit dem Veröffentlichen des Artikels.",
    ],
    related: ["kopf-knoepfe-und-widget", "ki-antworten"],
  },
  {
    slug: "ki-client-verbinden",
    icon: "code",
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
          "Lesen: Artikel, Entwürfe, Kategorien, Übersetzungen, Statistiken, Einstellungen — dazu die Schreib-Konventionen deines Hilfezentrums, damit die KI gültige Bausteine baut statt zu raten.\n\nArtikel schreiben und ändern: Artikel anlegen (immer als ENTWURF), Texte, Tabellen und Hinweisboxen ändern, ganze Seiten von einer Adresse übernehmen, Bilder hinzufügen — entweder von einer öffentlichen Adresse oder direkt als Datei von deinem Rechner, etwa einen Screenshot, den du gerade gemacht hast — Bildbeschreibungen nachbessern (auch viele auf einmal), Videos einzeln ändern und aus einem eingefügten Transkript Titel und Beschreibung erzeugen lassen. Nichts davon wird öffentlich.\n\nVeröffentlichen: macht Artikel sofort für alle Besucher sichtbar und erlaubt zusätzlich, die Reihenfolge der Navigation zu setzen — standardmäßig AUS.\n\nChangelog, Roadmap, Einstiegs-Karten und Kontaktwege pflegen: hier gibt es keinen Entwurf, Änderungen sind sofort öffentlich.\n\nLöschen: nur mit einer ausdrücklichen Bestätigung im KI-Gespräch (siehe unten) — standardmäßig AUS.",
      },
      "Der Klartext-Schlüssel wird genau einmal angezeigt, direkt nach dem Anlegen. Danach siehst du in der Liste nur noch, wofür er gilt, wann er zuletzt benutzt wurde und wann er abläuft (standardmäßig nach 90 Tagen). Du kannst ihn jederzeit mit einem Klick widerrufen — er wirkt sofort nicht mehr.",
      "Löschen ist absichtlich umständlich: Der erste Löschbefehl löscht nichts, sondern liefert eine Zusammenfassung dessen, was verschwinden würde, plus ein kurzlebiges Bestätigungs-Token. Erst ein zweiter Aufruf mit diesem Token löscht wirklich. Eine KI kann also nicht in einem Schritt Inhalte vernichten.",
      "Nicht per MCP erreichbar sind bewusst: Team und Rollen, Eigentümerschaft, Rechtstexte, eigene Domain, Plan und Bezahlung sowie die Schlüsselverwaltung selbst. Diese Flächen bleiben Mensch, Anmeldung und Zwei-Faktor-Authentifizierung vorbehalten — ein geleakter Schlüssel soll Inhalte gefährden können, niemals dein Konto.",
      "Die KI kann außerdem die Navigation ordnen, die Einstiegs-Karten der Startseite setzen und die Kontaktwege pflegen — alles drei wirkt sofort öffentlich und hängt deshalb an den entsprechenden Rechten, nicht am reinen Schreibrecht. Beim Ordnen genügt eine Teil-Liste: Genannte Artikel rücken nach vorn, alle übrigen behalten ihre bisherige Reihenfolge dahinter.",
      "Bei Kontaktwegen gilt eine Regel, die keine Technik erzwingen kann: Trage nur Adressen und Rufnummern ein, die du der KI wirklich genannt hast. Eine falsche Support-Adresse steht ausgerechnet dort, wo jemand landet, der schon nicht weiterkommt.",
      "Tipp: Lege lieber zwei enge Schlüssel an als einen Generalschlüssel — etwa einen reinen Lese-Schlüssel für Recherche und Auswertungen und einen Schreib-Schlüssel ohne Veröffentlichen für die Redaktion.",
    ],
    related: ["inhalte-importieren-exportieren", "artikel-veroeffentlichen", "navigation-und-einstieg"],
  },
  {
    slug: "api-dokumentation-verlinken",
    title: "API-Dokumentation verlinken",
    category: "Sichtbarkeit",
    min: 2,
    body: [
      "Hast du eine eigene API, kannst du deine Entwickler-Dokumentation aus dem Hilfezentrum heraus verlinken — als Aktions-Knopf im Kopf. Es gibt dafür keinen Sonderweg mehr: Du legst ihn unter »Navigation« an wie jeden anderen Knopf, mit Beschriftung, Symbol und Variante deiner Wahl.",
      "Nimm als Symbol »Code« und als Ziel deine https-Adresse; der Knopf öffnet automatisch in einem neuen Tab, weil das Ziel nach außen führt. Auf schmalen Bildschirmen bleibt nur das Symbol stehen. Entfernen heißt: Knopf löschen.",
      "Erlaubt sind ausschließlich vollständige https-Adressen. Der Grund: Dieser Link steht dauerhaft in der Navigation jedes Besuchers — dort gehört nichts hin, was unverschlüsselt lädt oder Skripte ausführen könnte.",
      "Warum wir deine API-Referenz nicht bei uns darstellen: Sie wird aus deinem Spec erzeugt und ändert sich mit jedem Release. Eine Kopie in deinem Hilfezentrum wäre nach deinem nächsten Deploy falsch. Deine Doku bleibt deshalb da, wo sie gepflegt wird — das Hilfezentrum führt nur hin.",
      "Beachte: Ein verlinktes Ziel ist für die KI-Antworten NICHT sichtbar. Sie kennt nur deine Artikel, Roadmap und Changelog. Fragen zu Endpunkten kann sie also noch nicht beantworten — dafür müssten die Inhalte in dein Hilfezentrum kommen.",
    ],
    related: ["artikel-veroeffentlichen", "ki-antworten"],
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

/**
 * Kontaktwege der Seite `/contact`. ECHTE Daten des Betreibers — hier gehört
 * nichts Erfundenes hin, das ist die Seite, auf der jemand landet, der schon
 * nicht weiterkommt. Beschreibungen bleiben bewusst knapp: Aussagen über
 * Reaktionszeiten oder Sprechzeiten wären ein Versprechen, das niemand
 * gegeben hat.
 */
const CONTACT_METHODS = [
  {
    kind: "email",
    title: "Schreib uns",
    // Keine Beschreibung: Die Karte zeigt die Adresse ohnehin darunter.
    description: "",
    value: "info@hallofhelp.com",
  },
  {
    kind: "phone",
    title: "Ruf uns an",
    description: "",
    value: "+49 163 1539033",
  },
  {
    kind: "form",
    title: "Anliegen schildern",
    description: "Deine Nachricht landet direkt in unserem Postfach.",
    value: null,
  },
];

/** Frage-Vorschläge unter der KI-Eingabe (0044, höchstens vier). */
const PROMPT_SUGGESTIONS = [
  "Wie erstelle ich mein erstes Hilfezentrum?",
  "Wie binde ich das Widget auf meiner Website ein?",
  "Wie verbinde ich meinen eigenen KI-Client?",
  "Was passiert, wenn mein Credit-Limit erreicht ist?",
];

/** Einstiegs-Karten unter der KI-Eingabe (höchstens sechs). */
const ENTRY_CARDS = [
  {
    kind: "article",
    title: "In zehn Minuten startklar",
    description: "Konto anlegen, Hilfezentrum erstellen, ersten Artikel veröffentlichen.",
    target: "hilfezentrum-erstellen",
  },
  {
    kind: "article",
    title: "Eigenen KI-Client verbinden",
    description: "Artikel per Claude, Cursor oder eigenem Agenten pflegen (MCP).",
    target: "ki-client-verbinden",
  },
  { kind: "roadmap", title: "Was als Nächstes kommt", description: "Woran wir gerade arbeiten." },
  { kind: "changelog", title: "Neu in dieser Version", description: "Alle ausgelieferten Änderungen." },
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
    title: "Fundstellen im Artikel, Schutz vor verlorenen Änderungen und eine Pflicht-Adresse",
    description:
      "Wer aus der Suche kommt, findet das gesuchte Wort jetzt im Artikel markiert wieder — eine Leiste unten springt mit Pfeilen von Stelle zu Stelle. Im Verwaltungsbereich warnt eine Rückfrage, bevor ungespeicherte Änderungen verloren gehen: hierbleiben, speichern und weiter, oder verwerfen. Im Kontaktformular ist die E-Mail-Adresse jetzt Pflicht, damit eine Antwort überhaupt möglich ist. Und der Link auf eine eigene API-Dokumentation ist kein Sonderfall mehr, sondern ein ganz normaler Aktions-Knopf im Kopf.",
    at: RELEASE_0_5_1,
    version: "0.5.1",
    level: "patch",
  },
  {
    title: "Suche im Volltext, Kopf-Knöpfe, Widget-Varianten und Verständnis-Hinweise",
    description:
      "Die Suche durchsucht jetzt auch den INHALT der Artikel und zeigt je Treffer den Textausschnitt mit markierter Fundstelle. Neu im Kopf: bis zu drei eigene Aktions-Knöpfe in vier Varianten — dieselben Varianten gibt es jetzt auch für den Widget-Starter, samt eigener Symbole und deinem Logo im Widget-Kopf. Und Leser können mit »Ich verstehe etwas nicht« direkt auf die unklare Stelle im Artikel klicken. Außerdem: wählbare Symbole je Artikel und ein ruhigeres, klareres Erscheinungsbild.",
    at: RELEASE_0_5_0,
    version: "0.5.0",
    level: "minor",
  },
  {
    title: "Kontaktwege per KI-Client pflegen",
    description:
      "Die Kontaktwege deiner Kontaktseite lassen sich jetzt auch über einen angebundenen KI-Client lesen und setzen — mit denselben Prüfungen wie im Verwaltungsbereich.",
    at: RELEASE_0_4_1,
    version: "0.4.1",
    level: "patch",
  },
  {
    title: "Neues Erscheinungsbild, Symbole je Artikel und eine Kontaktseite",
    description:
      "Das Hilfezentrum hat ein ruhigeres, klareres Erscheinungsbild: Seitenleiste und Inhalt liegen jetzt auf unterschiedlichen Flächen, statt nur durch eine Linie getrennt zu sein — Kategorien sind dadurch beim Überfliegen zu erkennen. Artikel können ein eigenes Symbol in der Navigation tragen (Standard bleibt: keins). Neu ist außerdem eine Kontaktseite mit E-Mail, Telefon und Formular, verlinkt unten in der Navigation. Der Link auf eine eigene API-Dokumentation steht jetzt oben im Kopf.",
    at: RELEASE_0_4_0,
    version: "0.4.0",
    level: "minor",
  },
  {
    title: "Navigation ordnen, Einstiegs-Karten und Beta-Kennzeichnung",
    description:
      "Die Reihenfolge von Artikeln und Kategorien in der linken Leiste legst du jetzt selbst fest — per Maus oder Tastatur unter »Navigation«. Auf der Startseite lassen sich bis zu sechs Einstiegs-Karten unter der KI-Eingabe zeigen (Artikel, Roadmap, Changelog oder externer Link). Und ein Artikel-Flag wie »Beta« erscheint ab sofort schon in der Navigation, nicht erst im Artikel. Alles drei auch per KI-Client über MCP.",
    at: RELEASE_0_3_0,
    version: "0.3.0",
    level: "minor",
  },
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
  // `sort` = Position im ARTICLES-Array: die Reihenfolge hier IST die Reihenfolge
  // in der linken Leiste (0034). Kategorien erben sie über ihren ersten Artikel.
  const flag = a.flag ? `'${esc(JSON.stringify(a.flag))}'` : "NULL";
  // Symbol (0036): Name aus dem Katalog; fehlt = keins (der Normalfall).
  const icon = a.icon ? `'${esc(a.icon)}'` : "NULL";
  out.push(
    `INSERT INTO articles (id,tenant_id,locale,slug,title,category,status,body_json,videos_json,related_ids_json,flag_json,icon,sort,reading_minutes,is_ai_generated,created_at,updated_at,published_at)\n` +
      `VALUES ('${id}','${TENANT}','${LOCALE}','${esc(a.slug)}','${esc(a.title)}','${esc(a.category)}','published','${body}','[]','${related}',${flag},${icon},${i},${a.min || 1},0,${t},${t},${t})\n` +
      `ON CONFLICT(tenant_id,id) DO UPDATE SET locale=excluded.locale,slug=excluded.slug,title=excluded.title,category=excluded.category,status='published',body_json=excluded.body_json,related_ids_json=excluded.related_ids_json,flag_json=excluded.flag_json,icon=excluded.icon,sort=excluded.sort,reading_minutes=excluded.reading_minutes,updated_at=excluded.updated_at,published_at=COALESCE(articles.published_at,excluded.published_at);`,
  );
});

// Frage-Vorschläge (0044) — seed-autoritativ.
out.push(`DELETE FROM prompt_suggestions WHERE tenant_id = '${TENANT}';`);
PROMPT_SUGGESTIONS.forEach((text, i) => {
  out.push(
    `INSERT INTO prompt_suggestions (id,tenant_id,text,sort) VALUES ('op_ps_${i + 1}','${TENANT}','${esc(text)}',${i})\n` +
      `ON CONFLICT(tenant_id,id) DO UPDATE SET text=excluded.text,sort=excluded.sort;`,
  );
});

// Kontaktwege (0037) — seed-autoritativ wie Roadmap/Changelog.
out.push(`DELETE FROM contact_methods WHERE tenant_id = '${TENANT}';`);
CONTACT_METHODS.forEach((m, i) => {
  const id = "op_cm_" + (i + 1);
  const value = m.value ? `'${esc(m.value)}'` : "NULL";
  out.push(
    `INSERT INTO contact_methods (id,tenant_id,kind,title,description,value,sort) VALUES ('${id}','${TENANT}','${m.kind}','${esc(m.title)}','${esc(m.description)}',${value},${i})\n` +
      `ON CONFLICT(tenant_id,id) DO UPDATE SET kind=excluded.kind,title=excluded.title,description=excluded.description,value=excluded.value,sort=excluded.sort;`,
  );
});

// Einstiegs-Karten (0035) — unsere eigene Startseite zeigt, wofür sie da sind.
// Seed-autoritativ wie Roadmap/Changelog → alte Zeilen ersetzen.
out.push(`DELETE FROM entry_cards WHERE tenant_id = '${TENANT}';`);
ENTRY_CARDS.forEach((c, i) => {
  const id = "op_ec_" + (i + 1);
  const target = c.target ? `'${esc(c.target)}'` : "NULL";
  out.push(
    `INSERT INTO entry_cards (id,tenant_id,kind,title,description,target,sort) VALUES ('${id}','${TENANT}','${c.kind}','${esc(c.title)}','${esc(c.description)}',${target},${i})\n` +
      `ON CONFLICT(tenant_id,id) DO UPDATE SET kind=excluded.kind,title=excluded.title,description=excluded.description,target=excluded.target,sort=excluded.sort;`,
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
