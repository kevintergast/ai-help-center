import type { Locale } from "@/lib/tenant/types";
import { de, type MessageKey } from "./messages/de";
import { en } from "./messages/en";

const dicts: Record<Locale, Record<MessageKey, string>> = { de, en };

/**
 * Übersetzungs-Accessor. `getT(locale)("key", { var })`.
 * Interpolation über `{var}`. Fällt bei fehlendem Wert auf DE bzw. den Key zurück.
 */
export function getT(locale: Locale) {
  const dict = dicts[locale] ?? de;
  return (key: MessageKey, vars?: Record<string, string | number>): string => {
    let s: string = dict[key] ?? de[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replaceAll(`{${k}}`, String(v));
      }
    }
    return s;
  };
}
