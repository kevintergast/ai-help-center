# Bootstrap: Domain, E-Mail & Accounts

> Alles unten ist **als Privatperson** machbar — keine Firma nötig.
> Nur **Paddle-Live (Auszahlung), Rechnungen mit Firmenname/USt, Versicherung** und die Rechtstexte ([legal-todo.md](legal-todo.md)) warten auf die Gründung.

## 1. Domain & DNS (Cloudflare)
- [ ] Cloudflare-Account anlegen (privat)
- [ ] Brand-/Produkt-Domain registrieren via **Cloudflare Registrar** (Einkaufspreis). Falls TLD dort nicht verfügbar: extern kaufen (Porkbun/Namecheap) und **Nameserver auf Cloudflare** zeigen.
- [ ] WHOIS-Redaction (bei Cloudflare automatisch) prüfen
- Domain dient gleichzeitig als Basis für Kunden-Subdomains (`*.hallofhelp.com`) und Team-Mail.

## 2. E-Mail-Postfach — Zoho Mail Free (EU-Rechenzentrum)
- [ ] Zoho-Mail **Free-Plan** anlegen, **EU-Datacenter (zoho.eu)** wählen → EU-Datenresidenz
- [ ] Domain `hallofhelp.com` hinzufügen → Verifizierungs-**TXT** in Cloudflare DNS → verify
- [ ] Primäres Postfach **`kevin@hallofhelp.com`** anlegen (+ 2FA)
- [ ] **Aliase** (kein Extra-Seat): `support@` und `info@` auf kevin@ (später support@ als eigenes Postfach, wenn Team)
- [ ] **MX** (EU): `mx.zoho.eu` (Prio 10), `mx2.zoho.eu` (20), `mx3.zoho.eu` (50)
- [ ] **SPF** TXT `@`: `v=spf1 include:zoho.eu ~all` (Wert, den Zoho zeigt)
- [ ] **DKIM**: Selector/Wert aus Zoho-Admin → als TXT/CNAME in Cloudflare
- [ ] **DMARC** TXT `_dmarc`: `v=DMARC1; p=none; rua=mailto:dmarc@hallofhelp.com`
- Hinweis: alle Mail-Records = **DNS only** (graue Wolke). Cloudflare Email Routing für diese Domain **nicht** parallel (MX gehört Zoho). Günstige Alternative falls Zoho-Free-Limits stören: Migadu (~19 $/Jahr).

## 3. Transaktionale App-Mails (später, in der App-Phase)
- [ ] **Resend**-Account, Sende-Subdomain `mail.hallofhelp.com` mit eigenem SPF/DKIM/DMARC (getrennt von M365)

## 4. Service-Accounts (mit Rollen-Adressen)
- [ ] GitLab (`dev@`) — Projekt + Access-Token für Claude (scoped, read-only/MR)
- [ ] Cloudflare (bereits) — Staging-Rolle/Token für Claude
- [ ] Context7 MCP (kein Account nötig)
- [ ] Paddle **Sandbox** (`billing@`) — Live erst nach Firmengründung
- [ ] Sentry (`dev@`/`security@`) — wenn Monitoring-Phase erreicht

## 5. Sicherheit
- [ ] 2FA/MFA überall aktiv
- [ ] Passwortmanager
- [ ] M365-Admin-Konto getrennt vom Alltags-Postfach
