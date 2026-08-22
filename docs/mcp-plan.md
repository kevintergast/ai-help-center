# MCP-Server für KI-gestützte Artikel-Pflege — Plan

Stand: 2026-08-22. Ziel: Neben der REST-API (`/api/v1`) einen **eigenen MCP-Server** anbieten,
mit dem Kunden ihre Hilfeartikel **aus ihrem eigenen KI-Client heraus** erstellen, aktualisieren
und veröffentlichen lassen (Claude Code/Desktop, Cursor, ChatGPT-Connector, eigene Agenten).

**Owner-Tags:** `[DU]` = Kevin · `[CLAUDE]` = Claude · `[🤝]` = beide

---

## 1. Warum MCP (und warum es NICHT „nur die API mit anderem Namen" ist)

| | REST-API `/api/v1` | MCP-Server `/api/v1/mcp` |
|---|---|---|
| Zielgruppe | Entwickler, die integrieren | **KI-Clients der Kunden** (kein Code) |
| Kopplung | Kunde schreibt Client-Code | Kunde trägt **eine URL + Key** ein |
| Wer denkt? | Der Kunde | Das **LLM des Kunden** |
| Wer zahlt Inferenz? | — | **Der Kunde bei seinem Anbieter** |

Der entscheidende Punkt für unser Geschäftsmodell: **Die Intelligenz sitzt beim Client.**
Der Kunde sagt seinem Claude „lies unser Changelog und leg mir daraus Hilfeartikel an" —
das Schreiben passiert in *seinem* Abo, bei uns landen nur validierte Schreib-Calls.
Wir bekommen ein starkes Feature ohne neue variable KI-Kosten (Gegensatz zu `/ask`, das
hinter dem Credit-Gate hängt, siehe `src/server/rag/ask.ts`).

Zweitwert: MCP ist der natürliche **Import-Kanal**. „Übernimm unsere alte Zendesk-Doku"
wird zu einer Konversation statt zu einem Migrationsprojekt.

---

## 2. Ist-Stand (verifiziert im Code, 2026-08-22)

**Wiederverwendbar, nichts davon muss neu gebaut werden:**
- Hono-App mit Tenant-Middleware + Default-Deny (`src/server/api/app.ts`) — Tenant kommt
  **aus dem Host**, ALS-Boundary via `runWithTenant`.
- Content-Domäne komplett: `ContentStore` (create/update/publish/unpublish/listAdminRows/
  getForEdit, `src/server/content/store.ts`), Validierung `parseCreateArticle`/
  `parseUpdateArticle` (`src/server/content/validate.ts`), Block-Modell
  (`src/lib/content/blocks.ts`), URL-Import mit SSRF-Guard (`scrape.ts`), KI-Übersetzung
  (`translate.ts`), Video-Aufbereitung (`video-summary.ts`).
- Vectorize-Index-Sync am Lifecycle (`ContentIndexer`), Freeze-Gate (`billing/enforcement.ts`),
  IP-Rate-Limits (`api/rate-limit.ts`), Audit-Log (`auth/audit.ts`).

**Was fehlt (= dieser Plan):**
1. **Maschinen-Authentifizierung.** Es gibt heute *nur* Session-Auth, und Team-Routen
   erzwingen MFA (`auth/guards.ts`). Ein Agent kann kein TOTP tippen. Der TODO in
   `app.ts:174` („API-Key-Auth-Middleware + CORS") ist die Voraussetzung — MCP erbt sie.
2. Die MCP-Protokollschicht selbst.
3. Onboarding-UX (Key erzeugen, Connect-Snippet) + Dogfood-Artikel.

---

## 3. Protokollstand (recherchiert 2026-08-22, Spec-Revision **2026-07-28**)

Die aktuelle Revision hat den Transport **vereinfacht** — das kommt uns auf Workers entgegen:

- **Keine Sessions mehr, kein `initialize`-Handshake, kein GET-Stream.** Jede Nachricht ist
  ein eigener POST auf **einen** Endpoint; Protokollversion + Client-Capabilities reisen
  per Request in `params._meta["io.modelcontextprotocol/protocolVersion"]` usw.
  → **Wir brauchen keine Durable Objects und keinen State.** (Genau der Grund, warum wir
  den Cloudflare-`McpAgent` NICHT nehmen, s. E2.)
- Pflicht-Header je POST: `MCP-Protocol-Version`, `Mcp-Method`, sowie `Mcp-Name` bei
  `tools/call`/`resources/read`/`prompts/get`. **Header und Body müssen übereinstimmen**,
  sonst `400` + JSON-RPC-Fehler `-32020` (`HeaderMismatch`).
- Unbekannte Methode → **HTTP 404** + `-32601`. Unbekannte Protokollversion → `400` +
  `UnsupportedProtocolVersionError` mit Liste der unterstützten Versionen.
- `Origin` MUSS validiert werden (DNS-Rebinding), ungültig → `403`.
- Legacy: `GET`/`DELETE` auf den Endpoint → `405`; `Mcp-Session-Id`/`Last-Event-ID` ignorieren.
- Autorisierung ist formal OPTIONAL, für HTTP aber OAuth 2.1 als **Resource Server** mit
  Protected Resource Metadata (RFC 9728) + Audience-Prüfung (RFC 8707) vorgesehen;
  `401` trägt `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`,
  fehlender Scope → `403` mit `error="insufficient_scope"`.

**Realitäts-Abgleich:** Ausgelieferte Clients sprechen heute noch überwiegend die
`initialize`-Ära (`2025-06-18` / `2025-11-25`). Wir unterstützen deshalb **beide Ären**
(Schritt 2) — stateless auch in der Legacy-Ära (wir vergeben schlicht keine Session-ID).

Quellen: [Spec 2026-07-28](https://modelcontextprotocol.io/specification/latest) ·
[Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) ·
[Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

---

## 4. Architektur-Entscheidungen

**E1 — Ein Endpoint in der bestehenden Hono-App: `POST /api/v1/mcp`.**
Pro Tenant automatisch eine eigene MCP-URL (`https://<slug>.hallofhelp.com/api/v1/mcp`),
weil der Tenant aus dem Host kommt. Kein zweiter Worker, kein DO, ein Deploy.
*Verworfen:* Cloudflare Agents `McpAgent` (bräuchte DO + eigenen Worker-Entry neben OpenNext —
Zustand, den die neue Spec gar nicht mehr verlangt).

**E2 — Dünne eigene Protokollschicht statt `@modelcontextprotocol/sdk`.**
Das SDK ist Node-`req/res`-geprägt (Shim-Risiko unter OpenNext) und zieht Zod; das Projekt
validiert bewusst von Hand. Unsere Fläche ist klein: `tools/list`, `tools/call`, Versions-/
Header-Validierung, Fehler-Mapping — ca. 250 Zeilen, **in-process testbar über `app.request()`**
wie alle anderen API-Verträge. *Risiko:* Spec-Drift → Gegenmittel ist die Konformitäts-
Testsuite (Schritt 2) und eine gepinnte, explizit gelistete `SUPPORTED_PROTOCOL_VERSIONS`.

**E3 — Auth in zwei Stufen: erst API-Keys, dann OAuth.**
Stufe 1 = **Bearer-API-Key** (Schritt 1): deckt Claude Code, Cursor, eigene Agenten und die
öffentliche REST-API ab, ist in Tagen fertig und ohne Fremdabhängigkeit testbar.
Stufe 2 = **OAuth 2.1** über das `mcp`-Plugin von better-auth (in v1.6.23 vorhanden:
`better-auth/plugins/mcp` mit `withMcpAuth`, PRM- und AS-Metadata) für Ein-Klick-Connectors
in claude.ai/Claude Desktop. Reihenfolge ist bewusst so: OAuth ist Komfort, Key ist Substanz.

**E4 — Ein API-Key ist ein EIGENER Prinzipal mit sichtbarem Berechtigungs-Profil.**
Keine Cookie-Session wird akzeptiert (s. E7). Was der Key darf, entscheiden **Scopes**, die
der Kunde beim Anlegen einzeln wählt und deren Wirkung ihm im Klartext angezeigt wird (§6).
Warum das die MFA-Pflicht aus `guards.ts` nicht aufweicht:
- Ein Key entsteht **nur** aus einer MFA-verifizierten `admin`/`owner`-Session.
- Er erreicht nur die in §5 gelisteten Flächen — **niemals** Team/Rollen/Ownership,
  Rechtstexte, Custom-Domain, Plan/Billing oder die Key-Verwaltung selbst (§5, harte Grenze).
- Er ist einzeln widerrufbar, hat ein Ablaufdatum, wird protokolliert und zeigt „zuletzt
  benutzt".
Damit ist der Key strikt schwächer als jede Team-Session — kein neuer Privilegienpfad.

**E5 — Schreiben erzeugt Entwürfe. Veröffentlichen ist ein eigener Scope.**
`create_article` liefert immer `status='draft'`. `publish_article` verlangt den Scope
`articles:publish`, der beim Key-Anlegen **standardmäßig AUS** ist. Ein halluzinierter
Artikel darf niemals ohne menschliche Freigabe auf der Kundendomain landen —
das ist zugleich unser Verkaufsargument („KI schreibt, Mensch gibt frei").

**E6 — MCP-Schreibzugriffe kosten keine Credits, werden aber gezählt.**
Es entstehen uns keine Inferenzkosten (E1 der Produktidee), also wäre eine Credit-Belastung
willkürlich. Wir schreiben `usage_events` vom Typ `mcp_call` mit `credits=0`,
damit Nutzung sichtbar und Missbrauch erkennbar ist. Kostenpunkt ehrlich benannt:
der `type`-CHECK ist eine Allowlist, und SQLite kann CHECKs nicht ändern → es braucht
den bekannten Rebuild (`usage_events_v6`, Muster 0011/0016/0020/0026). **Ausnahme:** Tools, die *unsere* KI
starten (`translate_article`), verbuchen ihre bestehenden Credits unverändert.

**E7 — Der MCP-Endpoint akzeptiert AUSSCHLIESSLICH `Authorization: Bearer`, niemals Cookies.**
Das ist die tragende CSRF-Entscheidung: ohne ambiente Credentials kann keine fremde Website
den Endpoint im Browser des eingeloggten Kunden fahren. Erst dadurch dürfen wir CORS
großzügig setzen (`Access-Control-Allow-Origin: *`, **ohne** `Allow-Credentials`), was
Browser-basierte Clients überhaupt erst ermöglicht. Die `Origin`-Prüfung der Spec bleibt
als zweite Schicht.

**E8 — Tool-Rückgaben sind Daten, keine Anweisungen.**
Alles, was aus fremden Quellen stammt (URL-Import, später Support-Tickets), wird im
Tool-Result als untrusted markiert und nie als Instruktion formuliert. Destruktive/
schreibende Tools tragen `annotations` (`readOnlyHint`, `destructiveHint`), damit Clients
korrekt nachfragen.

**E9 — Zerstörende Aktionen brauchen eine Bestätigung IN der KI-Sitzung.**
`delete_article` & Co. löschen nie im ersten Call. Der erste Aufruf liefert eine
Zusammenfassung dessen, was verschwinden würde (Titel, Slug, Status, Bilder, Übersetzungen,
Aufrufe der letzten 30 Tage) plus ein **kurzlebiges, einmal verwendbares Bestätigungs-Token**.
Erst der zweite Aufruf mit diesem Token löscht. Wo der Client **Elicitation** kann, holen wir
zusätzlich einen echten Ja/Nein-Dialog beim Menschen ein; das Token ist die Garantie, die
Elicitation der Komfort (Details: §7).

**E10 — Berechtigungen werden aktiv erklärt, nicht nur angehakt.**
Die Key-Erstellung zeigt pro Scope die Konsequenz in Klartext, färbt nach Risikostufe und
warnt eskalierend, je mehr ein Schlüssel darf (§6). Ein Key, der veröffentlichen UND löschen
darf, wird als solcher benannt — nicht in einer Checkbox-Liste versteckt.

---

## 5. Scope- und Tool-Katalog v1 („so viel wie möglich, aber sichtbar")

Leitlinie: **alles, was Inhaltspflege ist, geht per MCP.** Die Grenze verläuft dort, wo ein
geleakter Schlüssel nicht mehr Inhalte kaputt macht, sondern das Konto.

### Stufe 1 — Lesen (grün, unkritisch)
| Scope | Tools |
|---|---|
| `articles:read` | `list_articles`, `get_article`, `search_articles`, `list_categories`, `list_translations`, `get_roadmap`, `get_changelog`, `export_articles`, `get_content_conventions` |
| `analytics:read` | `get_stats` (Aufrufe/Tagesreihe/Top-Artikel/Hilfreich-Quote), `get_plan_usage` (Credits, MAU, Plan-Status) |
| `settings:read` | `get_branding`, `get_settings` |

`get_content_conventions` ist das **Schlüsseltool**: Block-Schema, Limits, Slug-Regeln,
reservierte Slugs, Tenant-Sprache, Ton. Damit baut das Client-LLM valide Blöcke, statt zu raten.
Dazu `get_permissions` (immer verfügbar): sagt dem Modell, was dieser Schlüssel darf —
verhindert Fehlversuche und macht die Grenze für den Nutzer im Chat sichtbar.

### Stufe 2 — Inhalte schreiben (gelb, bleibt intern sichtbar)
| Scope | Tools |
|---|---|
| `articles:write` | `create_article` (immer Entwurf), `update_article`, `import_article_from_url`, `add_image_from_url`, `add_video`, `prepare_video` (KI-Transkript → Titel/Beschreibung, kostet Credits), `create_translation` (manuell/KI, kostet Credits) |

### Stufe 3 — Öffentlich wirksam (orange, „Endkunden sehen das sofort")
| Scope | Tools |
|---|---|
| `articles:publish` | `publish_article`, `unpublish_article` |
| `settings:write` | `update_branding` (Farben, Header-Name), `update_settings` (SEO-Indexierung, Support-Adresse, Standardsprache) |
| `support:read` | `list_tickets` — **enthält personenbezogene Daten** von Endkunden (E-Mail-Adressen, Freitext) und wandert damit in den KI-Client des Kunden. Wird als solches gewarnt. |
| `support:write` | `update_ticket` (Status/Triage) |

### Stufe 4 — Zerstörend (rot, Bestätigungspflicht §7)
| Scope | Tools |
|---|---|
| `articles:delete` | `delete_article`, `delete_image` |
| `support:delete` | `delete_ticket` |

### Harte Grenze — nie per MCP `[Empfehlung, überstimmbar]`
Team/Einladungen/Rollen/**Ownership-Transfer**, Rechtstexte, Custom-Domain, Plan-/
Billing-Änderungen, die Key-Verwaltung selbst, Operator-Console.
Begründung, kurz: ein Schlüssel, der einladen oder Ownership übertragen kann, ist ein
**Konto-Übernahme-Werkzeug** in einem einzigen Call; Impressum/Datenschutz sind
rechtsverbindliche Texte, die keine KI ändern darf; die Domain entscheidet über die
Erreichbarkeit der ganzen Instanz. Der Ownership-Transfer verlangt heute sogar *frisches*
MFA (`api/team.ts:442`, `requireFreshMfa(300)`) — etwas, das ein Schlüssel per Definition
nicht leisten kann. Diese Flächen bleiben Mensch + Session + MFA.
Ebenfalls draußen: `reindex` (Reparatur-Werkzeug, kostet echte Embedding-Kosten — kein
Werkzeug für eine Agenten-Schleife).

**Fehler-Konvention:** Fachfehler sind **Tool-Results mit `isError: true`** und stabilem Code
(`slug_conflict`, `not_found`, `payment_required`, `confirmation_required` …) — nicht
JSON-RPC-Fehler. Nur so kann sich das Client-LLM selbst korrigieren („Slug vergeben → anderen
nehmen"). JSON-RPC-Fehler bleiben Protokollfehlern vorbehalten (`-32601`, `-32602`, `-32020`).

---

## 6. Der Schlüssel muss zeigen, was er darf (Anforderung Kevin)

**Beim Anlegen** (`/admin/api-keys`):
- Scopes gruppiert nach den vier Stufen, jede mit Farbe, Icon und **Konsequenz in Klartext**
  statt Scope-Name: „Kann Artikel veröffentlichen — für alle Besucher sofort sichtbar."
- **Voreinstellung ist bewusst zahm:** nur `articles:read` + `articles:write` vorausgewählt.
  Alles Orange/Rot muss aktiv eingeschaltet werden.
- **Eskalierende Warnung**, live neben der Auswahl:
  - grün/gelb → ruhiger Hinweis: „Dieser Schlüssel kann Entwürfe erstellen. Nichts wird
    ohne dich veröffentlicht."
  - orange → gelbe Box: „Wirkt nach außen: Änderungen sind sofort für deine Kunden sichtbar."
  - `support:read` → eigene Box: „Personenbezogene Daten verlassen dein Hilfezentrum und
    landen bei deinem KI-Anbieter."
  - rot → rote Box + **eigene Checkbox je rotem Scope**: „Ich verstehe, dass eine KI mit
    diesem Schlüssel Artikel endgültig löschen kann."
  - Kombination publish+delete+settings → **Vollzugriff-Warnung** mit Empfehlung, den
    Schlüssel aufzuteilen (ein Lese-Key für Recherche, ein enger Schreib-Key).
- Ein **Risiko-Badge** (niedrig/mittel/hoch/kritisch) fasst die Auswahl in einem Wort zusammen.

**Nach dem Anlegen:** Klartext-Karte „Dieser Schlüssel darf: …" neben dem Kopierfeld — der
Klartext-Key ist genau hier einmal sichtbar und danach nie wieder.

**In der Liste:** je Schlüssel Risiko-Badge, ausgeschriebene Rechte, „zuletzt benutzt",
Ablaufdatum, Ein-Klick-Widerruf. Ein Schlüssel, der 60 Tage ungenutzt ist, wird als solcher
markiert („brauchst du den noch?").

**Und im Chat:** `get_permissions` liefert dieselbe Klartext-Liste an das Modell, damit der
Nutzer sie auch dort sieht und das Modell keine gesperrten Tools versucht.

---

## 7. Löschen nur mit Bestätigung (Anforderung Kevin)

Zwei Wege, bewusst kombiniert — der eine funktioniert überall, der andere ist schöner:

**(a) Bestätigungs-Token (die Garantie, clientunabhängig).**
1. `delete_article {id}` ohne Token → **löscht nichts**. Antwort: `status:
   "confirmation_required"` + Zusammenfassung (Titel, Slug, Status, Anzahl Bilder,
   Übersetzungen im Set, Aufrufe letzte 30 Tage) + `confirmation_token`.
2. Das Modell muss diese Zusammenfassung dem Menschen zeigen und darf erst nach dessen „ja"
   erneut aufrufen: `delete_article {id, confirmation_token}`.
3. Das Token ist ein HMAC über `tenant | articleId | keyId | Inhalts-Hash | Ablauf`
   (5 Minuten), signiert mit `AUTH_SECRET`, und **einmal verwendbar** (Verbrauch in KV
   `CACHE`). Es ist damit nicht erfindbar, nicht wiederverwendbar und ungültig, sobald sich
   der Artikel zwischenzeitlich geändert hat.

**(b) Elicitation (der Komfort, wo der Client sie kann).**
Meldet der Client in seinen Capabilities Elicitation, fordert der Server zusätzlich einen
echten Ja/Nein-Dialog beim Menschen an (in der aktuellen Spec als `InputRequiredResult`
eingebettet, in der Legacy-Ära als `elicitation/create`). Kann er es nicht, bleibt (a)
allein wirksam — es gibt keinen Pfad ohne Bestätigung.

Dazu: `annotations: { destructiveHint: true, idempotentHint: false }` an allen roten Tools
(viele Clients fragen dann von sich aus nach), Audit-Eintrag mit Key-ID, und die
Löschung ist scope-pflichtig (`articles:delete`, standardmäßig aus).

**Offen (Empfehlung: ja, aber eigener Schritt):** 30-Tage-Papierkorb statt Hard-Delete.
Das ist die eigentliche Rettungsleine gegen einen entgleisten Agenten, berührt aber jede
Store-Abfrage (`deleted_at IS NULL`) — deshalb bewusst nicht in v1 hineingedrückt.

---

## 8. Sicherheits-Invarianten (jede Zeile = ein Test)

1. Tenant kommt **nur** aus dem Host — niemals aus einem Tool-Argument.
2. Key von Tenant A auf Host B → `401` (Lookup ist `WHERE tenant_id=? AND key_hash=?`).
3. Kein Cookie-Pfad auf `/api/v1/mcp` (E7).
4. Key-Klartext existiert genau einmal: in der Antwort des Erzeugens. Gespeichert wird
   SHA-256 + 8-Zeichen-Präfix zur Wiedererkennung.
5. Scope-Prüfung **pro Tool**; fehlender Scope → `403` + `insufficient_scope`. Tools ohne
   Scope tauchen in `tools/list` gar nicht erst auf (aber `tools/call` prüft trotzdem —
   Verstecken ist kein Schutz).
6. Harte Grenze (§5): kein MCP-Weg zu Team/Ownership, Rechtstexten, Domain, Plan, Keys,
   Operator — unabhängig davon, welche Scopes ein Key trägt.
7. Zerstörende Tools ohne gültiges, unverbrauchtes Bestätigungs-Token löschen nichts (§7).
8. Freeze-Gate greift auch hier: nach abgelaufener Grace sind Mutationen `402`.
9. Rate-Limit pro Key (nicht nur pro IP) — ein Agent in einer Schleife ist der Normalfall.
10. Jede Mutation → Audit-Eintrag mit Key-ID als Akteur.
11. Widerruf und Ablauf wirken sofort (kein Cache über Request-Grenzen).

---

## 9. Schritte (Reihenfolge = Abhängigkeiten)

> **STAND 2026-08-22 abends — Schritte 1–4 und 6 gebaut, Gates grün** (typecheck ·
> lint · i18n · 605 Tests). Live gegen den lokalen Worker verifiziert: `tools/list`
> zeigt nur erlaubte Werkzeuge, `create_article` liefert einen Entwurf,
> `publish_article` ohne Scope → 403, Löschen erst nach Bestätigung.
> **Offen:** Medien-/Video-/Übersetzungs-Tools, Einstellungen- und Support-Tools
> (Scopes existieren bereits), `mcp_call`-Metering (Migration 0029), Connect-Seite
> mit Client-Snippets, Dogfood-Artikel, OAuth.

### Schritt 1 — API-Keys + Scope-Modell ✅ `[CLAUDE]` (Fundament, nutzt auch der REST-API)
- Migration `0027_api_keys.sql`: `api_key(tenant_id, id, name, key_hash, key_prefix,
  scopes, created_by, created_at, last_used_at, expires_at, revoked_at)`, PK `(tenant_id,id)`,
  Index auf `key_hash`, FK auf `tenants ON DELETE CASCADE` (Muster 0005/0009).
- `src/server/apikeys/{scopes,keys,store}.ts` — Scope-Katalog als **einzige Quelle**
  (Stufe, Klartext-Konsequenz, Risikogewicht), Erzeugen (`hoh_<env>_<32 base62>`),
  SHA-256-Hash, Verifikation.
- Default-Deny in `app.ts` (2) erweitert: gültige Session **ODER** gültiger Bearer-Key
  setzt `c.set("principal", …)`. Pfad bleibt nicht-öffentlich; Snapshot-Test in
  `app.security.test.ts` bewusst mitziehen.
- Guard `requireScope("articles:write")` analog `requireTeam`.
- Admin-API `/admin/api-keys` (Liste/Anlegen/Widerrufen, `requireTeam("admin")`, MFA).
- **DoD:** Cross-Tenant-Test rot ohne Fix; Gates grün.

### Schritt 2 — Key-UI mit Warnungen ✅ `[CLAUDE]` (§6)
Seite „Zugriffs-Schlüssel": Stufen-Gruppen, Klartext-Konsequenzen, Risiko-Badge,
eskalierende Warnboxen, Pflicht-Checkbox je rotem Scope, Einmal-Anzeige des Klartext-Keys,
Liste mit „zuletzt benutzt"/Ablauf/Widerruf. Alle Strings DE **und** EN (`pnpm i18n:check`).
**DoD:** Im Preview durchgeklickt; ohne rote Checkbox lässt sich kein roter Scope speichern.

### Schritt 3 — MCP-Protokollschicht ✅ `[CLAUDE]`
- `src/server/mcp/{router,protocol,errors}.ts` + `app.route("/mcp", mcpRouter(deps))`.
- Beide Ären: moderne per-Request-Metadaten **und** `initialize` (stateless, keine Session-ID).
  `SUPPORTED_PROTOCOL_VERSIONS` explizit gelistet.
- Header/Body-Abgleich (`-32020`), Origin-Check (`403`), `GET`/`DELETE` → `405`,
  unbekannte Methode → `404` + `-32601`, CORS-Preflight (ohne `Allow-Credentials`, E7).
- Antwort immer `application/json` (SSE erst, wenn ein Tool wirklich lange läuft).
- **DoD:** Konformitäts-Testsuite grün; `npx @modelcontextprotocol/inspector` verbindet
  gegen `pnpm dev` und listet die erlaubten Tools.

### Schritt 4 — Lese-Tools ✅ (Stufe 1 komplett) `[CLAUDE]`
Stufe 1 komplett (§5) inkl. `get_content_conventions` und `get_permissions`.
Drift-Test: Tool-`inputSchema` und `validate.ts` behaupten dieselben Pflichtfelder/Limits.
**DoD:** In Claude Code verbunden, „welche Artikel habe ich, was läuft gut?" beantwortet.

### Schritt 5 — Schreib-Tools ◐ (Artikel-Kern steht; Medien/Video/Übersetzung/Einstellungen/Support offen) `[CLAUDE]`
Stufe 2 + 3 (§5). Index-Sync, Audit, `mcp_call`-Event (Migration `0030`, Rebuild-Muster s. E6).
**DoD:** Aus Claude Code ein Artikel aus einem Changelog erzeugt, im Editor geprüft,
per Tool veröffentlicht — Ende-zu-Ende auf Staging.

### Schritt 6 — Zerstörende Tools mit Bestätigung ✅ `[CLAUDE]` (§7)
Token-Mechanik (HMAC + KV-Einmalverbrauch), Elicitation wo verfügbar, `destructiveHint`,
Scope `articles:delete`/`support:delete`.
**DoD:** Test beweist, dass ohne Token nichts gelöscht wird und ein Token kein zweites Mal
funktioniert.

### Schritt 7 — Onboarding + Dogfooding `[🤝]`
Connect-Seite (Snippets für Claude Code/Desktop/Cursor), und laut CLAUDE.md **Pflicht**:
Operator-Artikel in `scripts/seed-operator-content.mjs` ergänzen — dokumentiert wird nur,
was dann real läuft.

### Schritt 8 — OAuth 2.1 für Ein-Klick-Connectors `[CLAUDE]`, Freigabe `[DU]`
better-auth `mcp`-Plugin (`better-auth/plugins`, verifiziert in v1.6.23; basiert auf
`oidc-provider` → eigene Migration). Issuer = Tenant-Origin, Consent im Tenant-Login inkl.
MFA, PRM unter `/.well-known/oauth-protected-resource`, Audience-Prüfung gegen die MCP-URL.
Erst starten, wenn 1–7 live sind.

### Später, bewusst vertagt
- **Papierkorb** (30 Tage, statt Hard-Delete) — die eigentliche Rettungsleine, s. §7.
- `list_content_gaps` (Fragen ohne Grounding → Artikelvorschläge). **Blockiert durch eine
  Datenschutz-Entscheidung:** heute speichern wir Fragetexte NICHT (`rag/ask.ts` loggt nur
  die Länge). Neue personenbezogene Persistenz braucht AV-/Löschkonzept — eigener Plan.
- MCP-`prompts`/`resources`, SSE für Langläufer, Logo-Upload per MCP.

---

## 10. Tests (nach der Anti-Bloat-Doktrin: je Test ein benennbarer Fehlerfall)

- Key von Tenant A auf Host B → 401 *(Cross-Tenant-Leak)*
- Cookie-Session ohne Bearer auf `/mcp` → 401 *(CSRF-Pfad geschlossen, E7)*
- Key ohne `articles:publish` → Tool fehlt in `tools/list` **und** `tools/call` gibt 403
  *(Verstecken ist kein Schutz)*
- `create_article` → immer `draft` *(kein Auto-Publish, E5)*
- `delete_article` ohne Token → nichts gelöscht, `confirmation_required` *(§7)*
- Token zweimal benutzt → zweiter Versuch scheitert *(Einmalverbrauch)*
- Token eines anderen Artikels/Keys/Tenants → ungültig *(Bindung)*
- Widerrufener/abgelaufener Key → 401 *(Widerruf wirkt)*
- Freeze aktiv → Mutation `payment_required` *(Gate gilt auch für Maschinen)*
- Roter Scope ohne Bestätigungs-Checkbox → Key-Erstellung 400 *(UI-Warnung serverseitig
  gespiegelt — eine UI-Checkbox allein ist keine Kontrolle)*
- Header `Mcp-Name` ≠ `params.name` → `-32020`; unbekannte Methode → 404 + `-32601`;
  unbekannte Protokollversion → 400 + Versionsliste; ungültiger `Origin` → 403
- Tool-Schema vs. `validate.ts` Drift-Test
- Ungültige Blöcke aus dem LLM → `isError`-Result mit Code, kein 500

---

## 11. Entschieden (2026-08-22, Kevin: „so viel wie möglich per MCP … ansonsten go")

1. **Umfang:** maximal — Inhalte, Medien, Übersetzungen, Analytics, Branding/Einstellungen,
   Support-Tickets. Grenze bleibt bei Konto/Recht/Domain/Billing (§5), überstimmbar.
2. **Sichtbarkeit:** Berechtigungen im Klartext + eskalierende Warnungen + Risiko-Badge (§6).
3. **Löschen:** nur mit Bestätigung in der KI-Sitzung, Token-gesichert (§7).
4. **Plan-Gate:** MCP ab `starter` (Empfehlung übernommen — Free trägt keine Automatisierung).
5. **Key-Ablauf:** 90 Tage Default mit Verlängerung (Empfehlung übernommen).
6. **`translate_article`/`prepare_video` per MCP:** ja, sind bereits sauber bepreist.

Punkte 4–6 sind meine Empfehlungen aus v1, mit „go" übernommen — Widerspruch jederzeit
möglich, sie sind an genau einer Stelle konfiguriert (`pricing.ts` bzw. `apikeys/scopes.ts`).

---

## 12. Abgrenzung

Dieser Plan beschreibt den **Autoren-MCP** (Kunde pflegt Inhalte). Ein zweiter,
technisch trivialer Aufsatz wäre später ein **Leser-MCP** (`ask`-Tool, damit Endkunden das
Hilfezentrum aus ihrem KI-Client befragen) — gleiche Protokollschicht, andere Zielgruppe,
anderes Credit-Modell (`ai_generation`). Bewusst nicht Teil von v1.
