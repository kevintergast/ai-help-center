import type { Metadata } from "next";
import { getCurrentTenant } from "@/lib/tenant/current";
import { WidgetChat } from "@/components/widget/widget-chat";

/**
 * WIDGET-EMBED-SEITE (Bauphase Widget): läuft im Cross-Site-iframe auf
 * Kunden-Websites (Loader: /widget.js). Bewusst OHNE App-Shell — nur der
 * kompakte Chat; Branding kommt wie überall über die CSS-Variablen des
 * Root-Layouts (per Host aufgelöster Tenant). Kein X-Frame-Options/CSP-
 * frame-ancestors-Header: die Seite SOLL überall einbettbar sein.
 */

export const metadata: Metadata = {
  // Embed-Fläche: nie im Suchindex (das Hilfezentrum selbst ist die SEO-Fläche).
  robots: { index: false, follow: false },
};

export default async function WidgetPage() {
  const tenant = await getCurrentTenant();
  // Unbekannter Host: Root-Layout rendert die Not-Found-Shell; hier nichts.
  if (!tenant) return null;
  return <WidgetChat locale={tenant.defaultLocale} tenantName={tenant.name} />;
}
