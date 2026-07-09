# Legal & Go-to-Market — ToDo-Checkliste

> Überwiegend **geschäftliche/rechtliche** Aufgaben (kein Code) — vor Launch **anwaltlich prüfen** lassen.
> Die *technische* Umsetzung (Consent-Log in D1, PDF-Generierung, Pflichtseiten als Content-Typ, Re-Accept-Flow, Trust-Center via Cloudflare Pages) ist im Phasenplan (P0–P3) eingeplant; diese Liste deckt die **Inhalte**, die du / eine Kanzlei liefern müsst.

## 0. Voraussetzung — zuerst!
- [ ] **Unternehmen gründen** (z. B. UG/GmbH) — Basis für alles Folgende
- [ ] USt-IdNr. / Steuernummer beantragen
- [ ] Geschäftskonto + Paddle-Seller-Account (Sandbox → Live nach Gründung; Paddle braucht eine registrierte Entität für Auszahlungen)

## 1. Pflicht-Rechtsdokumente (Kauf-Blocker)
- [ ] AGB/MSA (DE+EN), versioniert, Click-wrap-Zustimmung im Checkout
- [ ] Eigene Datenschutzerklärung
- [ ] Impressum (§5 DDG)
- [ ] KI-Acceptable-Use-Policy (AUP) — an Freeze/Suspend gekoppelt
- [ ] AVV/DPA (Art. 28 DSGVO), self-service abschließbar + PDF, SCCs als Anhang
- [ ] Subprozessor-Liste (Cloudflare, Paddle, Resend, Monitoring) + 30-Tage-Änderungsbenachrichtigung
- [ ] Widerrufs-/Refund-Policy, konsistent mit Paddle (MoR)
- [ ] Rollenklärung Verantwortlicher (Tenant) vs. Auftragsverarbeiter (du); Tenant muss eigenes Impressum/Datenschutz im White-Label hinterlegen
- [ ] Lokalisierte Rechtstexte DE/EN mit Consent-Versionierung

## 2. KI-Compliance & Barrierefreiheit (Kauf-Blocker)
- [ ] Verbindliche Zusicherung „kein Training auf Kundendaten/Prompts" + Inferenz-Datenfluss/-Residenz dokumentiert
- [ ] KI-Transparenz-Disclaimer (EU AI Act Art. 50) am Widget & an generierten Artikeln
- [ ] WCAG 2.1 AA Audit (SPA, Widget, Editor) + veröffentlichtes Accessibility-Statement (BFSG/EAA, Pflicht seit 28.06.2025)

## 3. Trust & Procurement (für größere Kunden)
- [ ] Öffentliches Trust-/Security-Center (trust.<domain>)
- [ ] Security-Whitepaper (versioniert, PDF)
- [ ] Vorausgefüllte Security-Fragebögen (CAIQ-Lite / SIG-Core / VSA)
- [ ] Zertifizierungs-Roadmap SOC 2 / ISO 27001 (Drata/Vanta) — bis dahin Cloudflare-Berichte als Sub-Infra-Nachweis
- [ ] Jährlicher Pen-Test + öffentliches Attestation-Summary + security.txt/VDP
- [ ] Tenant-Isolations-Nachweis (dokumentiert + im Pen-Test/CI getestet)
- [ ] Vendor-Onboarding-Paket (Buyer Kit: Stammdaten, USt-ID, Versicherungsnachweis, Security-Summary)

## 4. Vertrag, Versicherung & SLA
- [ ] Cyber-/E&O-Versicherung + Haftungs-/Indemnification-Klauseln im MSA
- [ ] Plan-gestaffeltes SLA (Uptime, Reaktionszeiten S1–S4, Service-Credits)
- [ ] Exit-/Datenrückgabe- & Löschklausel in AGB/AVV (koppelt an Tenant-Komplettexport)
