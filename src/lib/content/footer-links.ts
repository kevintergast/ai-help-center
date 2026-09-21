import { isAllowedActionHref } from "./action-buttons";

/**
 * FUSS-LINKS des Hilfezentrums (0046).
 *
 * Der Fuß trug bisher DREI fest verdrahtete Rechtstext-Links — auf jeder
 * Instanz dieselben, unabhängig davon, ob dahinter etwas steht. Das war aus
 * zwei Gründen falsch:
 *
 *   1. RECHTLICH ist nur die Datenschutzerklärung überall nötig (Art. 13
 *      DSGVO greift, sobald personenbezogene Daten verarbeitet werden — und
 *      das tut jede Instanz). Das Impressum ist eine DACH-Pflicht (§5 DDG,
 *      ECG in AT, UWG in CH); AGB sind gar keine Pflicht, weil im
 *      Hilfezentrum kein Vertrag geschlossen wird.
 *   2. PRAKTISCH fehlt jeder Instanz genau der eine Link, den SIE braucht —
 *      Status-Seite, Hauptwebsite, Barrierefreiheit, Sicherheitskontakt.
 *
 * Deshalb: die drei Rechtstexte sind VORKONFIGURIERT (Standard an, damit
 * bestehende Instanzen unverändert aussehen) und einzeln abschaltbar; eigene
 * Links kommen als freie Liste dazu.
 *
 * WARUM HIER (lib, nicht server): dieselbe Prüfung für den Verwaltungsbereich
 * und für jede spätere Maschinen-Tür. Eine Funktion kann man nicht an einer
 * Tür vergessen.
 */

export interface FooterLink {
  id: string;
  label: string;
  /** Ziel: absolute https-Adresse ODER instanz-interner Pfad („/kontakt"). */
  href: string;
}

/**
 * Fünf reichen. Der Fuß ist eine Zeile, kein zweites Menü — wer dort zehn
 * Links unterbringt, hat keinen davon mehr platziert.
 */
export const MAX_FOOTER_LINKS = 5;
export const MAX_FOOTER_LABEL = 32;

/** Die drei vorkonfigurierten Rechtstexte (Reihenfolge = Anzeigereihenfolge). */
export const LEGAL_FOOTER_DOCS = ["imprint", "privacy", "terms"] as const;
export type LegalFooterDoc = (typeof LEGAL_FOOTER_DOCS)[number];

/** Welche Rechtstexte im Fuß stehen. Fehlend = alle drei (Bestandsverhalten). */
export type LegalFooterVisibility = Record<LegalFooterDoc, boolean>;

export const DEFAULT_LEGAL_FOOTER: LegalFooterVisibility = {
  imprint: true,
  privacy: true,
  terms: true,
};

/** Öffentlicher Pfad je Rechtstext — deutsche Namen (die Seite kennt beide). */
export const LEGAL_FOOTER_HREF: Record<LegalFooterDoc, string> = {
  imprint: "/legal/impressum",
  privacy: "/legal/datenschutz",
  terms: "/legal/agb",
};

export type FooterLinkError = "label_required" | "label_too_long" | "href_required" | "invalid_href";

export type FooterLinkParseResult =
  | { ok: true; link: Omit<FooterLink, "id"> }
  | { ok: false; error: FooterLinkError };

export function isLegalFooterDoc(v: unknown): v is LegalFooterDoc {
  return typeof v === "string" && (LEGAL_FOOTER_DOCS as readonly string[]).includes(v);
}

/**
 * Prüft einen eigenen Fuß-Link. Das Ziel läuft durch DIESELBE Regel wie die
 * Kopf-Knöpfe (`isAllowedActionHref`): nur https nach außen und interne Pfade
 * — kein `http:`, kein `javascript:`, keine protokoll-relativen Adressen.
 * Ein Link im Fuß steht auf JEDER Seite; er ist ein Klickziel, kein
 * Skript-Einstieg.
 */
export function parseFooterLinkInput(raw: unknown): FooterLinkParseResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "label_required" };
  const o = raw as Record<string, unknown>;

  const label = typeof o.label === "string" ? o.label.trim() : "";
  if (label.length === 0) return { ok: false, error: "label_required" };
  if (label.length > MAX_FOOTER_LABEL) return { ok: false, error: "label_too_long" };

  const href = typeof o.href === "string" ? o.href.trim() : "";
  if (href.length === 0) return { ok: false, error: "href_required" };
  if (!isAllowedActionHref(href)) return { ok: false, error: "invalid_href" };

  return { ok: true, link: { label, href } };
}

/** Liest die drei Schalter aus beliebigem Eingabe-JSON (fehlend = an). */
export function parseLegalFooterInput(raw: unknown): LegalFooterVisibility {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    imprint: o.imprint !== false,
    privacy: o.privacy !== false,
    terms: o.terms !== false,
  };
}
