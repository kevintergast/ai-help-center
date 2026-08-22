/**
 * YOUTUBE-METADATEN für die Video-Aufbereitung im Editor.
 *
 * WAS ZUVERLÄSSIG GEHT: der **Titel** über den offiziellen oEmbed-Endpunkt
 * (kein API-Key, kein OAuth, stabil).
 *
 * WAS NUR BEST EFFORT IST: das **Transkript**. YouTube hat dafür keine
 * offene API (`captions.download` verlangt OAuth des Video-EIGENTÜMERS, für
 * fremde Videos also unmöglich) und blockt automatisierte Abrufe der
 * Watch-Seite — aus Rechenzentrums-IPs wie Cloudflare Workers praktisch immer
 * (verifiziert 2026-08-22: 403). Deshalb ist der Abruf hier ein VERSUCH mit
 * kurzem Timeout; schlägt er fehl, fügt das Team das Transkript aus dem
 * YouTube-Transkript-Panel ein (`normalizePastedTranscript`). Kein
 * Fremdanbieter-Dienst — das würde die EU-Datenhoheit aufweichen.
 *
 * SSRF-sicher: In beiden Fällen bauen wir die URL selbst aus einer bereits
 * validierten 11-Zeichen-Video-Id (parseYouTubeId) — kein Nutzer-Input in der
 * Ziel-URL.
 */

/** Nur echte YouTube-Ids (parseYouTubeId liefert genau diese Form). */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
/** Deckel fürs eingefügte/abgerufene Transkript (Modell-Kontext + Kosten). */
export const MAX_TRANSCRIPT_CHARS = 40_000;
/** So viel Transkript geht ins Modell (Rest wird abgeschnitten). */
export const TRANSCRIPT_PROMPT_CHARS = 14_000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Minimaler HTML-/XML-Entity-Decoder (Transkripte enthalten &amp;#39; & Co.). */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Mehrfach-Whitespace/Zeilen zu einem Fließtext glätten. */
function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * YouTube-`timedtext`-XML → Fließtext. Format: `<text start="0" dur="3">…`.
 * Entities werden DOPPELT dekodiert (YouTube escaped in XML nochmals).
 */
export function parseTimedTextXml(xml: string): string {
  const parts: string[] = [];
  for (const m of xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const text = squash(decodeEntities(decodeEntities(m[1])).replace(/<[^>]+>/g, " "));
    if (text.length > 0) parts.push(text);
  }
  return squash(parts.join(" "));
}

/**
 * EINGEFÜGTES YouTube-Transkript aufräumen: Das Transkript-Panel liefert
 * abwechselnd Zeitstempel-Zeilen (`0:15`, `1:02:33`) und Textzeilen — teils
 * auch beides in einer Zeile. Ergebnis: reiner Fließtext ohne Zeitmarken.
 */
export function normalizePastedTranscript(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  for (const line of lines) {
    // Führende Zeitmarke entfernen; reine Zeitmarken-Zeilen fallen weg.
    const text = squash(line.replace(/^\s*\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*/, ""));
    if (text.length === 0) continue;
    if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) continue;
    parts.push(text);
  }
  return squash(parts.join(" ")).slice(0, MAX_TRANSCRIPT_CHARS);
}

/** Titel eines Videos über den offiziellen oEmbed-Endpunkt (`null` bei Fehler). */
export async function fetchVideoTitle(
  youtubeId: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  if (!VIDEO_ID_RE.test(youtubeId)) return null;
  try {
    const res = await fetchImpl(
      `https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${youtubeId}&format=json`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown };
    const title = typeof data.title === "string" ? data.title.trim() : "";
    return title.length > 0 ? title.slice(0, 200) : null;
  } catch {
    return null;
  }
}

/**
 * VERSUCH, das Transkript automatisch zu holen (s. Modul-Doku: scheitert aus
 * Worker-IPs erwartbar). Liefert `null`, statt zu werfen — der Aufrufer
 * fällt dann auf die manuelle Eingabe zurück.
 */
export async function tryFetchTranscript(
  youtubeId: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  if (!VIDEO_ID_RE.test(youtubeId)) return null;
  try {
    const watch = await fetchImpl(`https://www.youtube.com/watch?v=${youtubeId}&hl=de`, {
      headers: {
        // Ohne Browser-artige Header liefert YouTube fast immer eine
        // Consent-/Bot-Seite ohne Player-Daten.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "accept-language": "de-DE,de;q=0.9,en;q=0.8",
      },
    });
    if (!watch.ok) return null;
    const html = await watch.text();
    const tracks = /"captionTracks":(\[.*?\])/.exec(html);
    if (!tracks) return null;

    const parsed = JSON.parse(tracks[1]) as { baseUrl?: string; languageCode?: string }[];
    // Deutsche Spur bevorzugen, sonst die erste vorhandene.
    const track = parsed.find((t) => t.languageCode?.startsWith("de")) ?? parsed[0];
    if (!track?.baseUrl) return null;
    // baseUrl kommt aus YouTubes eigener Antwort (kein Nutzer-Input) und
    // muss ein YouTube-Host sein — Defense-in-Depth gegen manipulierte Daten.
    const url = new URL(decodeEntities(track.baseUrl));
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;

    const xml = await fetchImpl(url.toString());
    if (!xml.ok) return null;
    const text = parseTimedTextXml(await xml.text());
    return text.length > 0 ? text.slice(0, MAX_TRANSCRIPT_CHARS) : null;
  } catch {
    return null;
  }
}
