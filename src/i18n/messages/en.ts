import type { MessageKey } from "./de";

// `Record<MessageKey, string>` erzwingt: jeder DE-Key MUSS auch hier existieren
// → fehlende Übersetzungen brechen den Typecheck (i18n-Coverage-Garantie).
export const en: Record<MessageKey, string> = {
  "shell.helpCenter": "Help center",
  "tenantNotFound.title": "Instance not found",
  "tenantNotFound.body": "No help center is set up at this address. Please check the URL.",
  "meta.description": "{name} help center — answers, guides and support.",
  "home.title": "{name} Help Center",
  "home.subtitle":
    "The entire interface is white-label — logo, colors and language come from the tenant branding.",
  "home.primaryAction": "Primary action",
  "home.accent": "Accent",
  "home.switchHint":
    "Switch tenant: bottom right (dev mode only). Each switch navigates to its own subdomain — tenants stay strictly separated.",
};
