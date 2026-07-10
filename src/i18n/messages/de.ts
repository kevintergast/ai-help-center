// Quell-Katalog (DE). `MessageKey` ist die Wahrheit für alle Locales.
export const de = {
  "shell.helpCenter": "Hilfezentrum",
  "tenantNotFound.title": "Instanz nicht gefunden",
  "tenantNotFound.body":
    "Unter dieser Adresse ist kein Hilfezentrum eingerichtet. Bitte prüfe die URL.",
  "meta.description": "Hilfezentrum von {name} — Antworten, Anleitungen und Support.",
  "home.title": "Hilfezentrum von {name}",
  "home.subtitle":
    "Die gesamte Oberfläche ist White-Label — Logo, Farben und Sprache kommen aus dem Tenant-Branding.",
  "home.primaryAction": "Primär-Aktion",
  "home.accent": "Akzent",
  "home.switchHint":
    "Tenant wechseln: unten rechts (nur im Dev-Modus). Jeder Wechsel navigiert auf eine eigene Subdomain — die Mandanten bleiben strikt getrennt.",
} as const;

export type MessageKey = keyof typeof de;
