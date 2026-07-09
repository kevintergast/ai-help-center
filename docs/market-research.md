# Markt- & Positionierungs-Recherche

> Methodik: Deep-Research-Harness, 5 Such-Stränge, 25 Quellen gefetcht, 124 Claims extrahiert, 25 adversariell verifiziert (3-Stimmen-Voting). **15 bestätigt, 10 gekippt, 5 nach Synthese.** Stand ~Juni 2026 — Preise/Programme/APIs vor Go-to-Market neu prüfen.
> **Vertrauensgrad ehrlich:** Stark belegt sind Voice-Distribution (F6), Preis-Einordnung (F4) und zwei Wettbewerber-Schwächen (F1/F2). **Business-Case (F3) und GTM-Kanäle (F5) sind UNBELEGT** (Vendor-Claims wurden widerlegt) → siehe „Offene Punkte".

## 1. Verifizierte Erkenntnisse

### A) Voice-Bot-Distribution (hoch, 3-0)
- **Synthflow = einziger verifizierter Self-Service-Marketplace.** Drittanbieter können eigene Voice-Agent-Templates **veröffentlichen und monetarisieren**; Templates zeigen Nutzungszahlen (Beispiele: „Lead Qualification" 1,1k Nutzungen). → **Stärkster passiver Distributionshebel.**
- **Vapi = Partner-Programm, application-gated** (Bewerbung mit Geschäfts-/Team-Infos), kein Self-Service-Listing. Zwei Tracks (Solution + Technology Partner).
- **Retell & ElevenLabs:** robustes Webhook/Function-Calling, **kein verifiziertes Marketplace-Listing** (Status offen, nicht widerlegt).
- Quellen: synthflow.ai/marketplace, feedback.synthflow.ai/changelog, vapi.ai/partnerships

### B) Technische Machbarkeit der Voice-Integration (hoch, 3-0)
- Geplante Architektur (**Function-Call „Hilfeartikel abfragen" + Webhook → dynamischer Artikel mit Link**) ist bei **Vapi, Retell, ElevenLabs, Synthflow** über dokumentierte Webhook-/Custom-Tool-Schnittstellen umsetzbar — **keine plattformspezifische Sonderlösung nötig**.
- Quellen: docs.vapi.ai/tools/custom-tools, docs.retellai.com/features/webhook, elevenlabs.io/docs/.../server-tools, docs.synthflow.ai/create-a-custom-action

### C) Preis-Einordnung (hoch, 3-0)
- Nutzungs-/verbrauchsbasiert ist **marktüblich**: kapa.ai = Plattformgebühr + Antworten/Monat; Intercom Fin = **0,99 USD/Resolution (outcome-basiert)**.
- → **Credits+MAU ist wettbewerbsfähig und verständlich.** (Konkrete €-Größen der Wettbewerber NICHT belegbar — entsprechende Claims wurden gekippt.)
- Quellen: kapa.ai/pricing, intercom.com/pricing, fin.ai/pricing

### D) Angriffspunkt vs. Intercom Fin (hoch, 3-0)
- Fin: Kosten = gelöste Konversationen × 0,99 USD → **„besser/mehr gelöst = teurer"** (Dritt-Belege: Rechnungssprünge 4k→9k, 1,2k→10k USD/Monat).
- → **USP: planbare Kosten unabhängig vom Erfolg** (Credits+MAU) als direkter Kontrast.
- Realistischer Deflection-Benchmark: Fin nennt 67 %, Community real eher **25–60 %** (nicht hart verifiziert).

### E) Angriffspunkt vs. GitBook (mittel, 2-1, durch GitBook-Doku gegengeprüft)
- GitBook: **kein sauberer Markdown-Export** (Custom-Blöcke werden zu nicht-portablem HTML; Migration verliert Cross-Space-Links, Kommentare, Historie) → **Vendor-Lock-in**.
- → **USP: Anti-Lock-in + offener Export + EU-Datenresidenz/DSGVO** (wir haben versioniertes Export-Schema + Tenant-Komplettexport bereits geplant).

## 2. Abgeleitete USPs & Positionierung

1. **Planbare Kosten statt „Erfolg kostet mehr"** — Credits+MAU vs. outcome-Pricing (Fin).
2. **EU-Datenhoheit & kein Lock-in** — DSGVO/EU-Residenz + sauberer Export vs. US-zentrische Anbieter & GitBook-Lock-in. *(Stärkster DACH/EU-Hebel.)*
3. **Omnichannel inkl. Voice** — Hilfe nicht nur im Chat-Widget, sondern per Function-Call/Webhook in jedem Voice-Bot; dynamischer Artikel + Link. Selten nativ bei KB-Tools.
4. **Dynamische, RAG-generierte Artikel mit Zitaten** — lebende, faktenbasierte Antworten statt statischer KB oder flüchtiger Chat-Bubbles.

**Positionierungs-Satz (Entwurf):**
> „Das AI-First Hilfezentrum mit planbaren Kosten und EU-Datenhoheit — das deine Hilfeinhalte automatisch in Chat **und** jedem Voice-Bot ausspielt."

## 3. Voice-Bot-Distributionsplan
1. **Primär (passiv): Synthflow-Marketplace** — Template „AI-Hilfezentrum / Support-Deflection" veröffentlichen (einziger verifizierter Self-Service-Kanal, monetarisierbar).
2. **Sekundär (kuratiert): Vapi Technology Partner** — Partner-Bewerbung einreichen.
3. **Integration generisch bauen** — ein Function-Call-Tool + Webhook, das auf Vapi/Retell/ElevenLabs/Synthflow ohne Sonderlösung läuft.
4. **Retell/ElevenLabs:** via Webhook/Function-Calling anbinden; Marketplace-Status später prüfen. **Bland/Voiceflow:** noch unrecherchiert.

## 4. Offene Punkte (NICHT belegt — separat verifizieren)
- **F3 Business-Case:** Support-Deflection-ROI, Kostenersparnis, Time-to-Value, Buy-vs-Build-Ökonomie — **keine** verifizierten Zahlen (Vendor-Claims widerlegt). Braucht neutrale Primärdaten.
- **F5 GTM-Kanäle (DACH/EU):** Kanal-Priorisierung + CAC/Payback unbelegt (einziger CAC-Claim widerlegt).
- Marketplace-Status Retell/ElevenLabs; Function-Calling/Marketplace von Bland & Voiceflow; genaue Synthflow-Monetarisierungs-/Revenue-Share-Bedingungen und Vapi-Listing-Anforderungen.

## 5. NICHT verwenden (adversariell widerlegt)
kapa.ai-Vertragswerte (12k–83k USD); Mintlify-Preise & -Pain-Points (Quelle bunnydesk.ai unzuverlässig); GitBook-Trustpilot 1,9/5; kapa.ai 70 %/30 %-Fehlschlag-Statistiken; In-House-Baukosten 400–600k USD; die CAC-Benchmark-Zahlen; Behauptung „ElevenLabs hat keinen Marketplace" (Fehlen unbelegt).

## 6. Primärquellen
synthflow.ai/marketplace · vapi.ai/partnerships · docs.vapi.ai/tools/custom-tools · docs.retellai.com/features/webhook · elevenlabs.io/docs/agents-platform/customization/tools/server-tools · docs.synthflow.ai/create-a-custom-action · kapa.ai/pricing · intercom.com/pricing · fin.ai/pricing
