import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { getHelpCenterRepo } from "@/server/content/runtime";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { Card } from "@/components/ui/card";
import { NavOrderManager } from "@/components/admin/nav-order-manager";
import { EntryCardsManager } from "@/components/admin/entry-cards-manager";
import { ContactMethodsManager } from "@/components/admin/contact-methods-manager";
import { HeaderActionsManager } from "@/components/admin/header-actions-manager";
import { PromptSuggestionsManager } from "@/components/admin/prompt-suggestions-manager";

/**
 * NAVIGATION & EINSTIEG — Reihenfolge der linken Leiste (0034) und die Karten
 * unter der KI-Eingabe (0035). Beides entscheidet, was ein Besucher ZUERST
 * sieht, und gehört deshalb auf eine Seite.
 *
 * Das Admin-Layout gated bereits auf `content` — dieselbe Schwelle wie die
 * API (api/content.ts, api/entry-cards.ts), also kein zusätzliches Gate hier.
 *
 * Die Artikelauswahl der Karten kommt SERVERSEITIG und enthält nur
 * VERÖFFENTLICHTE Artikel: Eine Karte, die auf einen Entwurf zeigt, wäre für
 * jeden Endnutzer ein toter Link.
 */
export default async function AdminNavigationPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);

  const repo = await getHelpCenterRepo(tenant);
  const published = await repo.listArticles();
  const articles = published.map((a) => ({ slug: a.slug, title: a.title }));

  return (
    <div>
      <AdminPageHeader
        title={t("admin.navigation.title")}
        subtitle={t("admin.navigation.subtitle")}
      />

      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="mb-3 text-base font-semibold">{t("admin.navOrder.title")}</h2>
          <NavOrderManager locale={tenant.defaultLocale} />
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold">{t("admin.suggestions.title")}</h2>
          <PromptSuggestionsManager locale={tenant.defaultLocale} />
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold">{t("admin.entryCards.title")}</h2>
          <EntryCardsManager locale={tenant.defaultLocale} articles={articles} />
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold">{t("admin.headerActions.title")}</h2>
          <HeaderActionsManager locale={tenant.defaultLocale} />
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold">{t("admin.contact.title")}</h2>
          <ContactMethodsManager locale={tenant.defaultLocale} />
        </Card>
      </div>
    </div>
  );
}
