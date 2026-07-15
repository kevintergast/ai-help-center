/**
 * Validierung für BYO-Custom-Domains (Infra-Plan Schritt 5).
 *
 * Konservativ: kleingeschriebene LDH-Hostnames (Letter/Digit/Hyphen) mit
 * mindestens zwei Labels. IDN nur als Punycode (xn--…) — wir raten nicht an
 * Unicode herum. Reserviert sind unsere eigenen Zonen (Slug-Routing!) und
 * lokale/numerische Hosts.
 */

const MAX_DOMAIN_LENGTH = 253;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Zonen, die nie als Kunden-Domain beanspruchbar sind. */
const RESERVED_SUFFIXES = ["hallofhelp.com", "workers.dev", "localhost"];

export type DomainValidation =
  | { ok: true; domain: string }
  | { ok: false; error: "invalid_domain" | "reserved_domain" };

export function normalizeCustomDomain(value: unknown): DomainValidation {
  if (typeof value !== "string") return { ok: false, error: "invalid_domain" };
  let v = value.trim().toLowerCase();
  if (v.endsWith(".")) v = v.slice(0, -1);
  if (v.length < 4 || v.length > MAX_DOMAIN_LENGTH) return { ok: false, error: "invalid_domain" };
  // URL-/Whitespace-Zeichen hart raus (Scheme-/Pfad-Schmuggel); Bindestrich
  // bleibt erlaubt — die Label-Regex unten ist die autoritative Prüfung.
  if (/[\s/@:?#\\]/.test(v)) return { ok: false, error: "invalid_domain" };

  const labels = v.split(".");
  if (labels.length < 2) return { ok: false, error: "invalid_domain" };
  if (!labels.every((l) => LABEL_RE.test(l))) return { ok: false, error: "invalid_domain" };
  // Rein numerische TLD = IP-artig (1.2.3.4) → keine Domain.
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return { ok: false, error: "invalid_domain" };

  for (const suffix of RESERVED_SUFFIXES) {
    if (v === suffix || v.endsWith(`.${suffix}`)) return { ok: false, error: "reserved_domain" };
  }
  return { ok: true, domain: v };
}

/** Name des TXT-Records, den der Kunde bei seinem DNS-Anbieter anlegt. */
export function txtRecordName(domain: string): string {
  return `_hallofhelp-verify.${domain}`;
}
