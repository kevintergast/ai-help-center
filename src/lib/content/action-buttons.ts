import { isArticleIcon, type ArticleIcon } from "./article-icons";

/**
 * AKTIONS-KNÖPFE — gemeinsamer Unterbau für die Knöpfe im Kopf des
 * Hilfezentrums (0038) und für den Widget-Starter.
 *
 * EIN Gestaltungsbegriff für beide Flächen: Wer die vier Varianten einmal
 * versteht, versteht sie überall. Zwei getrennte Begriffe hätten bedeutet,
 * dass „Filled" an zwei Stellen zweierlei heißt.
 *
 * WARUM KEINE FREIE FARBE: Die Variante bestimmt die Farbe, nicht der Nutzer.
 * `colored` nimmt die Marken-Farbe der Instanz — die ist bereits gepflegt und
 * bereits auf Kontrast geprüft. Ein freier Farbwähler daneben würde genau das
 * unterlaufen: Man könnte einen Knopf setzen, dessen Schrift auf der eigenen
 * Fläche nicht mehr lesbar ist, und das White-Label würde uneinheitlich.
 */

export const ACTION_VARIANTS = ["ghost", "outlined", "filled", "colored"] as const;
export type ActionVariant = (typeof ACTION_VARIANTS)[number];

export interface ActionButton {
  id: string;
  label: string;
  /** Symbolname aus dem Artikel-Katalog; leer = nur Text. */
  icon: ArticleIcon | null;
  /** Ziel: absolute https-Adresse ODER instanz-interner Pfad („/kontakt"). */
  href: string;
  variant: ActionVariant;
}

/** Drei Knöpfe füllen den Kopf. Mehr ist keine Aktion mehr, sondern ein Menü. */
export const MAX_ACTION_BUTTONS = 3;
export const MAX_ACTION_LABEL = 24;
const MAX_HREF_CHARS = 500;

export type ActionButtonError =
  | "label_required"
  | "label_too_long"
  | "invalid_icon"
  | "invalid_variant"
  | "href_required"
  | "invalid_href";

export type ActionButtonParseResult =
  | { ok: true; button: Omit<ActionButton, "id"> }
  | { ok: false; error: ActionButtonError };

export function isActionVariant(v: unknown): v is ActionVariant {
  return typeof v === "string" && (ACTION_VARIANTS as readonly string[]).includes(v);
}

/**
 * Ziel prüfen. Erlaubt sind NUR https nach außen und interne Pfade.
 *
 * `http:` fehlt bewusst: Der Knopf steht im Kopf JEDER Seite: ein Ziel, das
 * unverschlüsselt lädt, gehört da nicht hin. `javascript:`, `data:` und
 * protokoll-relative Adressen („//fremde.example") sind ohnehin nur
 * Umgehungsversuche — ein Knopf ist ein Klickziel, kein Skript-Einstieg.
 */
export function isAllowedActionHref(raw: string): boolean {
  const href = raw.trim();
  if (href.length === 0 || href.length > MAX_HREF_CHARS) return false;
  if (href.startsWith("//")) return false;
  if (href.startsWith("/")) return true;
  try {
    return new URL(href).protocol === "https:";
  } catch {
    return false;
  }
}

/** Führt das Ziel aus dem Hilfezentrum heraus? (→ neuer Tab + Außen-Symbol) */
export function isExternalHref(href: string): boolean {
  return !href.startsWith("/");
}

export function parseActionButtonInput(raw: unknown): ActionButtonParseResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_variant" };
  const o = raw as Record<string, unknown>;

  const label = typeof o.label === "string" ? o.label.trim() : "";
  if (label.length === 0) return { ok: false, error: "label_required" };
  if (label.length > MAX_ACTION_LABEL) return { ok: false, error: "label_too_long" };

  if (!isActionVariant(o.variant)) return { ok: false, error: "invalid_variant" };

  // Symbol ist freiwillig; ein unbekannter Name wird abgelehnt, nicht
  // verschluckt — sonst setzt jemand ein Symbol und sieht keins.
  let icon: ArticleIcon | null = null;
  if (o.icon !== undefined && o.icon !== null && o.icon !== "") {
    if (!isArticleIcon(o.icon)) return { ok: false, error: "invalid_icon" };
    icon = o.icon;
  }

  const href = typeof o.href === "string" ? o.href.trim() : "";
  if (href.length === 0) return { ok: false, error: "href_required" };
  if (!isAllowedActionHref(href)) return { ok: false, error: "invalid_href" };

  return { ok: true, button: { label, icon, href, variant: o.variant } };
}

/**
 * Tailwind-Klassen je Variante. Hier und nur hier — damit Kopf-Knopf und
 * Widget-Starter garantiert gleich aussehen.
 */
export const ACTION_VARIANT_CLASSES: Record<ActionVariant, string> = {
  ghost: "text-ink-muted hover:bg-tint hover:text-ink",
  outlined: "border border-hairline text-ink hover:border-hairline-strong hover:bg-tint",
  filled: "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] hover:opacity-90",
  colored: "bg-brand text-brand-fg hover:opacity-90",
};
