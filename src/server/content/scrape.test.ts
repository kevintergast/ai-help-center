import { describe, expect, it } from "vitest";
import { assertImportableUrl, extractArticleFromHtml, slugFromUrl } from "./scrape";

/**
 * Verhinderte Fehlerfälle:
 *  - SSRF: eine „Import"-URL zeigt auf localhost/Metadaten-IP und unser
 *    Worker holt interne Daten (klassischer Server-Side-Request-Forgery).
 *  - Der Import wirft Navigation/Breadcrumbs in den Artikel (Müll im Index)
 *    oder verliert die REIHENFOLGE von Text/Bild/Video (Kevins Kernwunsch).
 *  - Relative Bild-/Link-Pfade landen unauflösbar im Artikel.
 *  - Roh-HTML fließt in den Body (XSS-Fläche + kaputte Darstellung).
 *
 * Das Fixture bildet die ECHTE Struktur von help.smao.ai nach (verifiziert
 * 2026-08-22: <article> mit Breadcrumb-nav, ant-design-Klassen, relative
 * Bild-URLs mit Alt-Text, YouTube-Embed).
 */

const BASE = new URL("https://help.smao.ai/help/integrationen/hubspot");

const FIXTURE = `<!doctype html><html><head><title>HubSpot verbinden | smao Hilfe</title>
<script>self.__next_f.push([1,"lots of payload"])</script><style>.x{}</style></head><body>
<article class="ant-flex css-ypkju9">
  <nav class="ant-breadcrumb"><ol><li><a href="/help">Hilfeartikel</a></li><li><a href="/help/einstellungen/integrationen">Integrationen</a></li></ol></nav>
  <h1>HubSpot verbinden</h1>
  <p>Zuletzt aktualisiert: 5.2.2026</p>
  <p>Mit der <strong>HubSpot-Integration</strong> synchronisierst du Kontakte. Mehr dazu in den <a href="/help/knowledge/wissensdatenbanken">Wissensdatenbanken</a> oder bei <a href="https://hubspot.com/docs">HubSpot</a>.</p>
  <h2>Voraussetzungen</h2>
  <ul><li>Ein HubSpot-Konto</li><li>Adminrechte in <em>smao</em></li></ul>
  <img decoding="async" alt="Screenshot: HubSpot verbinden" class="ant-image-img" src="/images/hubspot/hubspot-connect.png">
  <h2>Schritte</h2>
  <ol><li>Einstellungen öffnen</li><li>Integration wählen</li></ol>
  <pre><code>API_KEY=abc123
SCOPE=contacts</code></pre>
  <blockquote>Hinweis: Der Schlüssel wird verschlüsselt gespeichert.</blockquote>
  <iframe src="https://www.youtube.com/embed/15XVU_jECHc" allowfullscreen></iframe>
  <img alt="" src="/images/hubspot/hubspot-settings.png">
  <button>Feedback geben</button>
  <footer><p>Fußzeile mit Rechtstexten</p></footer>
</article></body></html>`;

describe("assertImportableUrl (SSRF-Schutz)", () => {
  it("erlaubt öffentliche http(s)-Adressen", () => {
    expect(assertImportableUrl("https://help.smao.ai/help/x")).toMatchObject({ ok: true });
    expect(assertImportableUrl("http://example.com/a")).toMatchObject({ ok: true });
  });

  it("lehnt interne Ziele, IP-Literale, exotische Ports und Nicht-HTTP ab", () => {
    for (const bad of [
      "http://localhost/x",
      "http://app.localhost:3000/x",
      "http://127.0.0.1/x",
      "http://169.254.169.254/latest/meta-data/", // Cloud-Metadaten
      "http://10.0.0.5/internal",
      "http://[::1]/x",
      "http://intranet.local/x",
      "http://service.internal/x",
      "https://example.com:8443/x",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "nicht-mal-eine-url",
      "https://kein-punkt/x",
    ]) {
      expect(assertImportableUrl(bad).ok, bad).toBe(false);
    }
  });
});

describe("extractArticleFromHtml", () => {
  const res = extractArticleFromHtml(FIXTURE, BASE);

  it("nimmt den h1-Titel, nicht den <title> mit Marken-Suffix", () => {
    expect(res.title).toBe("HubSpot verbinden");
  });

  it("erhält die REIHENFOLGE von Text, Bild, Video", () => {
    expect(res.blocks.map((b) => (b.type === "text" ? `text:${b.variant}` : b.type))).toEqual([
      "text:standard", // „Zuletzt aktualisiert"
      "text:standard", // Einleitung
      "text:standard", // ## Voraussetzungen
      "text:standard", // Liste
      "image",
      "text:standard", // ## Schritte
      "text:standard", // nummerierte Liste
      "text:code",
      "text:standard", // Zitat
      "video",
      "image",
    ]);
  });

  it("übersetzt Auszeichnung in unser Markdown-Subset und macht Links absolut", () => {
    const intro = res.blocks[1];
    expect(intro).toMatchObject({ type: "text" });
    const text = (intro as { text: string }).text;
    expect(text).toContain("**HubSpot-Integration**");
    // Relativer Link → absolut; externer Link bleibt.
    expect(text).toContain("[Wissensdatenbanken](https://help.smao.ai/help/knowledge/wissensdatenbanken)");
    expect(text).toContain("[HubSpot](https://hubspot.com/docs)");
    // NIE Roh-HTML im Body.
    expect(text).not.toContain("<");
  });

  it("Überschriften, Listen, Code und Zitate landen in der Subset-Syntax", () => {
    const texts = res.blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    expect(texts).toContain("## Voraussetzungen");
    expect(texts).toContain("- Ein HubSpot-Konto\n- Adminrechte in *smao*");
    expect(texts).toContain("1. Einstellungen öffnen\n2. Integration wählen");
    expect(texts.some((t) => t.startsWith("> Hinweis:"))).toBe(true);
    const code = res.blocks.find((b) => b.type === "text" && b.variant === "code");
    expect((code as { text: string }).text).toBe("API_KEY=abc123\nSCOPE=contacts");
  });

  it("filtert Navigation, Buttons und Fußzeile heraus", () => {
    const all = JSON.stringify(res.blocks);
    expect(all).not.toContain("Hilfeartikel");
    expect(all).not.toContain("Feedback geben");
    expect(all).not.toContain("Fußzeile");
  });

  it("Bilder: absolute URL + Alt-Text als Beschreibung; ohne Alt → Hinweis", () => {
    expect(res.images).toEqual([
      {
        placeholderId: "scraped-image-1",
        url: "https://help.smao.ai/images/hubspot/hubspot-connect.png",
        description: "Screenshot: HubSpot verbinden",
      },
      {
        placeholderId: "scraped-image-2",
        url: "https://help.smao.ai/images/hubspot/hubspot-settings.png",
        description: "Bild 2 (Beschreibung bitte ergänzen)",
      },
    ]);
    expect(res.warnings).toContain("image_without_alt");
    // Block-Referenzen zeigen auf die Platzhalter (Route ersetzt sie nach Upload).
    expect(res.blocks.filter((b) => b.type === "image")).toEqual([
      { type: "image", imageId: "scraped-image-1" },
      { type: "image", imageId: "scraped-image-2" },
    ]);
  });

  it("YouTube-Embed → Video-Block mit Id; fremde Embeds werden gemeldet", () => {
    expect(res.videos).toEqual([{ id: "scraped-video-1", youtubeId: "15XVU_jECHc" }]);
    const withVimeo = extractArticleFromHtml(
      `<article><h1>T</h1><iframe src="https://player.vimeo.com/video/1"></iframe></article>`,
      BASE,
    );
    expect(withVimeo.videos).toEqual([]);
    expect(withVimeo.warnings).toContain("embed_skipped");
  });

  it("data:-Bilder werden ignoriert (kein Binär-Müll im Import)", () => {
    const res2 = extractArticleFromHtml(
      `<article><h1>T</h1><img alt="x" src="data:image/png;base64,AAAA"></article>`,
      BASE,
    );
    expect(res2.images).toEqual([]);
  });

  it("ohne <article>: fällt auf <main> bzw. das Dokument zurück", () => {
    const res3 = extractArticleFromHtml(
      `<html><body><main><h1>Nur Main</h1><p>Inhalt hier.</p></main></body></html>`,
      BASE,
    );
    expect(res3.title).toBe("Nur Main");
    expect(res3.blocks).toEqual([{ type: "text", variant: "standard", text: "Inhalt hier." }]);
  });
});

describe("slugFromUrl", () => {
  it("nimmt das letzte Pfadsegment, normalisiert Umlaute/Endungen", () => {
    expect(slugFromUrl(new URL("https://help.smao.ai/help/integrationen/hubspot"))).toBe("hubspot");
    expect(slugFromUrl(new URL("https://x.de/hilfe/Erste-Schritte.html"))).toBe("erste-schritte");
    expect(slugFromUrl(new URL("https://x.de/hilfe/Über-Uns/"))).toBe("ueber-uns");
    expect(slugFromUrl(new URL("https://help.smao.ai/"))).toBe("help-smao-ai");
  });
});

describe("Tabellen + Hinweisboxen (Import-Analyse 2026-08-22)", () => {
  // Verhinderte Fehlerfälle, beide an echten smao-Artikeln gefunden:
  //  - <table> ging KOMPLETT verloren (Parameter-Übersichten in n8n/API-Docs).
  //  - Hinweisboxen halten ihren Text in <div> mit <br> statt in <p> — der
  //    ganze Abschnitt fehlte im Import (Zendesk-Artikel, 5 Absätze).
  it("Tabelle mit thead → table-Block mit Kopfzeile und Zeilen", () => {
    const res = extractArticleFromHtml(
      `<article><h1>T</h1>
        <table class="ant-table">
          <thead><tr><th>Feld</th><th>Inhalt</th></tr></thead>
          <tbody>
            <tr><td>phone</td><td>Zielrufnummer, z. B. <strong>+49123</strong></td></tr>
            <tr><td>status</td><td>Startwert pending</td></tr>
          </tbody>
        </table></article>`,
      BASE,
    );
    expect(res.blocks).toEqual([
      {
        type: "table",
        head: ["Feld", "Inhalt"],
        rows: [
          ["phone", "Zielrufnummer, z. B. **+49123**"],
          ["status", "Startwert pending"],
        ],
      },
    ]);
  });

  it("Tabelle OHNE thead: erste th-Zeile wird Kopfzeile", () => {
    const res = extractArticleFromHtml(
      `<article><h1>T</h1><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></article>`,
      BASE,
    );
    expect(res.blocks[0]).toEqual({ type: "table", head: ["A", "B"], rows: [["1", "2"]] });
  });

  it("Hinweisbox (div mit <br>-Text) → Callout-Block in der richtigen Variante", () => {
    const res = extractArticleFromHtml(
      `<article><h1>T</h1>
        <p>Vorher.</p>
        <div class="ant-alert ant-alert-warning"><div class="help-prose">Achtung: Die Reihenfolge zählt.<br /><strong>1. Telefonnummer</strong><br />Wird zuerst geprüft.</div></div>
        <p>Nachher.</p></article>`,
      BASE,
    );
    expect(res.blocks.map((b) => (b.type === "text" ? b.variant : b.type))).toEqual([
      "standard",
      "warning",
      "standard",
    ]);
    const callout = res.blocks[1] as { text: string };
    expect(callout.text).toContain("Achtung: Die Reihenfolge zählt.");
    expect(callout.text).toContain("**1. Telefonnummer**");
    // Reihenfolge bleibt: Box steht ZWISCHEN den Absätzen.
    expect((res.blocks[2] as { text: string }).text).toBe("Nachher.");
  });

  it("Box MIT eigenen <p> wird nicht doppelt importiert", () => {
    const res = extractArticleFromHtml(
      `<article><h1>T</h1><div class="callout"><p>Nur einmal.</p></div></article>`,
      BASE,
    );
    expect(res.blocks).toEqual([{ type: "text", variant: "standard", text: "Nur einmal." }]);
  });
});

describe("Aufklappbare Abschnitte + Trennlinien (Import)", () => {
  // Verhinderter Fehlerfall: <details> ist in Hilfezentren die verbreitete
  // FAQ-Form. Ohne eigene Behandlung würde der Titel (summary) als Fließtext
  // im Absatz verschwinden ODER der Inhalt zweimal auftauchen (einmal als
  // Accordion, einmal durch den Hauptlauf über die inneren <p>).
  it("<details> → EIN accordion-Block, Inhalt nicht doppelt", () => {
    const res = extractArticleFromHtml(
      `<article><h1>FAQ</h1>
        <p>Vorher.</p>
        <details>
          <summary>Was kostet das?</summary>
          Ab 29 Euro im Monat.
        </details>
        <p>Nachher.</p></article>`,
      BASE,
    );
    expect(res.blocks).toEqual([
      { type: "text", variant: "standard", text: "Vorher." },
      { type: "accordion", title: "Was kostet das?", text: "Ab 29 Euro im Monat." },
      { type: "text", variant: "standard", text: "Nachher." },
    ]);
  });

  it("<hr> wird zur Trennlinie — in der richtigen Reihenfolge", () => {
    const res = extractArticleFromHtml(
      `<article><h1>T</h1><p>Erster Teil.</p><hr /><p>Zweiter Teil.</p></article>`,
      BASE,
    );
    expect(res.blocks).toEqual([
      { type: "text", variant: "standard", text: "Erster Teil." },
      { type: "divider" },
      { type: "text", variant: "standard", text: "Zweiter Teil." },
    ]);
  });

  it("<details> ohne summary fällt auf den Inhaltsanfang als Titel zurück", () => {
    const res = extractArticleFromHtml(
      `<article><h1>T</h1><details>Nur Inhalt, kein Titel.</details></article>`,
      BASE,
    );
    expect(res.blocks).toEqual([
      { type: "accordion", title: "Nur Inhalt, kein Titel.", text: "Nur Inhalt, kein Titel." },
    ]);
  });
});
