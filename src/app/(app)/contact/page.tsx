import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentTenant } from "@/lib/tenant/current";
import { readPageViewer } from "@/server/auth/page-guard";
import { getHelpCenterData } from "@/server/content/runtime";
import { showsAt } from "@/lib/content/meeting";
import { getT } from "@/i18n/t";
import { ContactPage } from "@/components/help-center/contact-page";

/**
 * `/contact` (Migration 0037). Der Pfad ist englisch und sprachneutral wie
 * `/legal/[doc]` — er ist ein ROUTEN-Name, kein Anzeigetext; die Überschrift
 * kommt aus der i18n.
 *
 * OHNE gepflegten Weg → 404. Eine Kontaktseite, die keinen Kontakt anbietet,
 * wäre schlimmer als gar keine: Wer hier landet, kommt ohnehin schon nicht
 * weiter. Aus demselben Grund zeigt auch die Navigation den Link dann nicht.
 */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  if (!tenant) return {};
  const t = getT(tenant.defaultLocale);
  return { title: `${t("hc.contact.title")} · ${tenant.name}` };
}

export default async function ContactRoute() {
  const tenant = await getCurrentTenant();
  if (!tenant) notFound();

  const data = await getHelpCenterData(tenant);
  // Die Seite existiert, sobald es IRGENDEINEN Weg gibt — auch wenn das nur
  // der Buchungslink ist (0048). Ohne diese Ergänzung hätte eine Instanz, die
  // ausschließlich Termine anbietet, eine 404-Seite statt eines Angebots.
  if (data.contactMethods.length === 0 && !showsAt(data.meeting, "contact")) notFound();

  return (
    <ContactPage
      locale={tenant.defaultLocale}
      tenantName={tenant.name}
      logoUrl={tenant.branding.logoUrl}
      logoDarkUrl={tenant.branding.logoDarkUrl ?? null}
      faviconUrl={tenant.branding.faviconUrl ?? null}
      showName={tenant.showHeaderName ?? true}
      data={data}
      isOperator={tenant.id === "t_operator"}
      viewer={await readPageViewer(tenant)}
    />
  );
}
