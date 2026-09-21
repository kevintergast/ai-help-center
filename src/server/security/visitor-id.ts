import { deriveTenantKey } from "@/server/auth/crypto";

/**
 * BESUCHER-IDs OHNE COOKIE (0046-Messung, ersetzt das `hoh_vid`-Cookie).
 *
 * WARUM ÜBERHAUPT: Die anonyme Besucher-ID steuert View-Dedup und MAU. Als
 * Cookie war sie einwilligungspflichtig — §25 TDDDG erlaubt Speichern/Lesen
 * auf dem Endgerät ohne Einwilligung nur, wenn es für den vom Nutzer
 * AUSDRÜCKLICH GEWÜNSCHTEN Dienst unbedingt erforderlich ist. Gewünscht ist
 * ein Hilfeartikel; die Wiedererkennung über 13 Monate dient unserer Zählung.
 * Damit hätte JEDE Kundeninstanz ein Einwilligungs-Banner gebraucht — auf
 * einer Seite, die nur helfen soll.
 *
 * LÖSUNG: nichts mehr im Endgerät ablegen. Die ID wird bei jedem Request
 * SERVERSEITIG aus Merkmalen abgeleitet, die der Browser ohnehin mitschickt:
 *
 *     visitorId = HMAC( HKDF(AUTH_SECRET, tenantId + period), fingerprint )
 *
 * Damit greift §25 TDDDG nicht (nichts wird auf dem Endgerät gespeichert
 * oder von dort abgefragt); die serverseitige Pseudonymisierung trägt
 * Art. 6 (1) f DSGVO. Gespeichert wird ausschließlich der Hash.
 *
 * NUR PASSIV GESENDETE MERKMALE: Adresse, User-Agent, Sprachwunsch und die
 * NIEDRIG-entropen Client-Hints, die Chromium von sich aus schickt. Wir
 * fordern bewusst KEINE weiteren Hints per `Accept-CH` an — das aktive
 * Abfragen von Geräte-Merkmalen wäre Fingerprinting und fiele wieder unter
 * §25 TDDDG, also zurück zum Banner. Diese Grenze ist der Grund, warum die
 * Zählung nicht exakt sein KANN.
 *
 * WARUM DIE PERIODE IM SCHLÜSSEL und nicht der Tag: MAU zählt DISTINCT
 * visitor_id je Abrechnungsmonat (usage_mau). Ein täglich rotierendes Salz —
 * wie es Reichweiten-Zähler für TAGESunikate verwenden — machte aus einem
 * Besucher, der an zehn Tagen kommt, zehn MAU und damit die Abrechnung
 * unbrauchbar. Mit der Periode als Schlüssel-Kontext ist die ID innerhalb des
 * Monats stabil und über Monatsgrenzen hinweg NICHT verknüpfbar (das Salz
 * wechselt) — die Aufbewahrungsgrenze ist also eingebaut.
 *
 * GENAUIGKEIT — die Richtungen sind NICHT gleich schlimm. Weil die MAU eine
 * harte Plan-Grenze ist, drängt jede ÜBERzählung einen Kunden zu Unrecht ins
 * Upgrade; das ist der teure Fehler. UNTERzählung (viele Menschen hinter
 * einer Adresse mit gleichem Browser) kostet uns nur Grenze, nicht Umsatz —
 * die Nutzung selbst schlägt sich in Credits nieder, und die zählen exakt.
 * Die Ableitung ist deshalb konsequent auf STABILITÄT getrimmt (siehe
 * `visitorFingerprint`), nicht auf maximale Trennschärfe. Das Ops-Dashboard
 * zeigt auffällig geteilte Herkunft, damit Unterzählung sichtbar bleibt.
 *
 * KEIN AUTH_SECRET (dev ohne Bindings) ⇒ Codec entfällt (runtime-deps lässt
 * das Feld weg) und der Aufrufer vergibt eine Zufalls-ID — dort gibt es kein
 * Billing. Deployed ist AUTH_SECRET immer vorhanden.
 */

/** Passiv mitgesendete Merkmale eines Requests (nichts davon wird gespeichert). */
export interface VisitorSignals {
  /** Client-Adresse (cf-connecting-ip). */
  ip: string;
  userAgent: string;
  /** `accept-language`. */
  acceptLanguage?: string;
  /** `sec-ch-ua-platform` — Chromium sendet das ohne Anforderung. */
  platform?: string;
  /** `sec-ch-ua-mobile`. */
  mobile?: string;
}

export interface VisitorIdCodec {
  /**
   * Pseudonyme Besucher-ID für diesen Request. Gleiche Merkmale in derselben
   * Periode ⇒ gleiche ID (das IST das Dedup); andere Periode oder anderer
   * Mandant ⇒ unverknüpfbar andere ID.
   */
  derive(input: { tenantId: string; period: string; signals: VisitorSignals }): Promise<string>;
}

const ID_CHARS = 22; // 128 Bit HMAC-Präfix, base64url (22 Zeichen)
const MAX_UA_CHARS = 300;

/**
 * Adresse auf den stabilen Teil kürzen.
 *
 * IPv6: nur das /64-Präfix. Praktisch jeder Anschluss bekommt ein festes
 * /64 zugewiesen und würfelt die hinteren 64 Bit selbst aus (Privacy
 * Extensions, RFC 4941) — oft MEHRMALS AM TAG. Die volle Adresse zu nehmen
 * hieße, denselben Menschen im Monat dutzendfach zu zählen; das /64 ist die
 * Ebene, die tatsächlich dem Anschluss entspricht.
 *
 * IPv4: unverändert. Ein /24 wäre hier kein Anschluss, sondern ein
 * beliebiger Ausschnitt eines Provider-Pools — das würde fremde Haushalte
 * zusammenwerfen, also in die teure Richtung (Unterzählung) übertreiben.
 */
export function ipKey(raw: string): string {
  const ip = raw.trim().toLowerCase();
  if (!ip.includes(":")) return ip; // IPv4 oder der dev-Platzhalter "local"

  // IPv4-mapped (::ffff:203.0.113.7) → die eingebettete IPv4 ist gemeint.
  const last = ip.slice(ip.lastIndexOf(":") + 1);
  if (last.includes(".")) return last;

  let groups: string[];
  if (ip.includes("::")) {
    const [head, tail = ""] = ip.split("::");
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  } else {
    groups = ip.split(":");
  }
  return groups
    .slice(0, 4)
    .map((g) => (g === "" ? "0" : g.replace(/^0+(?=.)/, "")))
    .join(":");
}

/**
 * User-Agent auf die HAUPT-Versionen kürzen („Chrome/131.0.6778.86" →
 * „Chrome/131").
 *
 * Das ist die wichtigste Korrektur überhaupt: Chrome und Edge aktualisieren
 * sich etwa alle vier Wochen, Firefox ähnlich. Mit voller Versionsnummer
 * bekäme ein großer Teil ALLER Besucher mitten im Monat eine neue Kennung
 * und zählte doppelt — eine Überzählung, die jeden Monat zuverlässig
 * wiederkehrt und Kunden grundlos an ihre Plan-Grenze drückt.
 *
 * Nebeneffekt in die richtige Richtung: weniger Entropie, also weniger
 * Fingerprint.
 */
export function uaKey(raw: string): string {
  return raw.trim().slice(0, MAX_UA_CHARS).replace(/(\d+)\.[\d.]+/g, "$1");
}

/**
 * Sprachwunsch auf das erste Tag kürzen („de-DE,de;q=0.9,en;q=0.8" →
 * „de-DE"). Die Gewichtungsliste dahinter unterscheidet sich zwischen
 * Browser-Versionen und Aufrufarten; das erste Tag ist der stabile Teil.
 */
export function langKey(raw: string): string {
  return raw.split(",")[0].trim().toLowerCase().slice(0, 20);
}

/**
 * Die gehashte Eingabe. Zeilenumbrüche als Trenner, damit benachbarte Felder
 * nicht ineinanderlaufen: ohne sie ergäben („1.2.3", „4Mozilla…") und
 * („1.2.34", „Mozilla…") dieselbe Zeichenkette und damit denselben Besucher.
 */
export function visitorFingerprint(s: VisitorSignals): string {
  return [
    ipKey(s.ip),
    uaKey(s.userAgent),
    langKey(s.acceptLanguage ?? ""),
    (s.platform ?? "").trim().toLowerCase().slice(0, 40),
    (s.mobile ?? "").trim().toLowerCase().slice(0, 8),
  ].join("\n");
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Eigener HKDF-Kontext je Mandant UND Periode: Besucher-Schlüssel ≠
 * Cookie-/State-Schlüssel, und zwei Monate ergeben aus derselben Person zwei
 * unverknüpfbare Pseudonyme.
 */
async function periodKey(secret: string, tenantId: string, period: string): Promise<CryptoKey> {
  const derived = await deriveTenantKey(secret, `${tenantId}:visitor-id:${period}`);
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(derived),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export function makeVisitorIdCodec(authSecret: string): VisitorIdCodec {
  return {
    async derive({ tenantId, period, signals }): Promise<string> {
      const key = await periodKey(authSecret, tenantId, period);
      const mac = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(visitorFingerprint(signals)),
      );
      return base64url(new Uint8Array(mac)).slice(0, ID_CHARS);
    },
  };
}
