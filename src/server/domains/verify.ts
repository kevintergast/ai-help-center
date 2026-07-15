import { txtRecordName } from "./validate";

/**
 * TXT-Ownership-Check über DNS-over-HTTPS (Cloudflare-Resolver).
 *
 * Der Kunde legt `_hallofhelp-verify.<domain>` mit dem Token als TXT-Wert an;
 * wir prüfen per DoH (kein eigener DNS-Stack im Worker nötig). Fail-closed:
 * jeder Zweifel (Timeout, Resolver-Fehler, kein Treffer) verifiziert NICHT.
 */

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DNS_TIMEOUT_MS = 10_000;

export type TxtCheckResult = "verified" | "not_found" | "mismatch" | "dns_error";

export type TxtChecker = (domain: string, expectedToken: string) => Promise<TxtCheckResult>;

/** Frisches Verifikations-Token (URL-/TXT-sicher, 128 bit). */
export function newVerificationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `hoh-verify-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

interface DohAnswer {
  type: number;
  data?: string;
}

/** TXT-Antworten kommen als (ggf. mehrteilig) gequotete Strings — entquoten + joinen. */
function unquoteTxt(data: string): string {
  const parts = data.match(/"((?:[^"\\]|\\.)*)"/g);
  if (!parts) return data.trim();
  return parts.map((p) => p.slice(1, -1).replace(/\\(.)/g, "$1")).join("");
}

export function makeTxtChecker(fetchImpl: typeof fetch = fetch): TxtChecker {
  return async (domain, expectedToken) => {
    const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(txtRecordName(domain))}&type=TXT`;
    let payload: { Status?: number; Answer?: DohAnswer[] };
    try {
      const res = await fetchImpl(url, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
      });
      if (!res.ok) return "dns_error";
      payload = (await res.json()) as typeof payload;
    } catch {
      return "dns_error";
    }

    const txts = (payload.Answer ?? [])
      .filter((a) => a.type === 16 && typeof a.data === "string")
      .map((a) => unquoteTxt(a.data as string));
    if (txts.some((t) => t === expectedToken)) return "verified";
    if (txts.length > 0) return "mismatch";
    return "not_found";
  };
}
