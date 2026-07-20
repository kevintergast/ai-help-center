import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { BrandingManager } from "@/components/admin/branding-manager";
import { CustomDomainManager } from "@/components/admin/custom-domain-manager";
import { LegalDocsManager } from "@/components/admin/legal-docs-manager";
import { SearchIndexManager } from "@/components/admin/search-index-manager";
import { SeoIndexingManager } from "@/components/admin/seo-indexing-manager";
import { SupportEmailManager } from "@/components/admin/support-email-manager";
import { WidgetSnippet } from "@/components/admin/widget-snippet";

function SettingsCard({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-hairline bg-surface p-6">
      <h2 className="mb-4 font-semibold tracking-[-0.3px]">{title}</h2>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

export default async function AdminSettingsPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const b = tenant.branding;

  return (
    <div>
      {/* Kein globaler Speichern-Button: jede Karte speichert selbst (der
          frühere Header-Button war ein toter Dummy — gemeldeter Bug). */}
      <AdminPageHeader
        title={t("admin.settings.title")}
        subtitle={t("admin.settings.subtitle")}
      />

      <div className="grid gap-6">
        <SettingsCard title={t("admin.settings.branding")}>
          {/* Echte Persistenz (Branding-API 0003 + Dark-Logo 0023) — ersetzt
              UploadPlaceholder + tote Farb-/Sprachfelder. */}
          <BrandingManager
            locale={tenant.defaultLocale}
            initialPrimary={b.colorPrimary}
            initialAccent={b.colorAccent}
            primaryFg={b.colorPrimaryFg}
            logoUrl={b.logoUrl}
            logoDarkUrl={b.logoDarkUrl ?? null}
          />
        </SettingsCard>

        <SettingsCard title={t("admin.settings.support")}>
          {/* Echte Persistenz (0014) — ersetzt das frühere tote Eingabefeld. */}
          <SupportEmailManager
            locale={tenant.defaultLocale}
            initialEmail={tenant.supportEmail ?? null}
          />
        </SettingsCard>

        <SettingsCard title={t("admin.settings.domain")}>
          <div className="max-w-md">
            <span className="mb-1.5 block text-sm text-ink-muted">
              {t("admin.settings.subdomain")}
            </span>
            <div className="rounded-std border border-hairline bg-surface-raised px-3 py-2 font-mono text-sm text-ink-muted">
              {`${tenant.slug}.hallofhelp.com`}
            </div>
          </div>
          {/* Funktionaler Verify-Flow (Infra-Plan Schritt 5): TXT-Challenge → verified. */}
          <CustomDomainManager locale={tenant.defaultLocale} />
        </SettingsCard>

        <SettingsCard title={t("admin.legal.title")}>
          {/* Rechtstexte (Design h): Link ODER Markdown/Upload; öffentlich unter /legal/<doc>. */}
          <LegalDocsManager locale={tenant.defaultLocale} />
        </SettingsCard>

        <SettingsCard title={t("admin.searchIndex.title")}>
          {/* KI-/Such-Index: Erst-Backfill + Reparatur (Lifecycle hält ihn sonst aktuell). */}
          <SearchIndexManager locale={tenant.defaultLocale} />
        </SettingsCard>

        <SettingsCard title={t("admin.settings.seo.title")}>
          {/* SEO-Opt-out (owner-only, Migration 0013): noindex + raus aus Sitemaps. */}
          <SeoIndexingManager
            locale={tenant.defaultLocale}
            initialIndexable={tenant.seoIndexable !== false}
          />
        </SettingsCard>

        <SettingsCard title={t("admin.settings.widget.title")}>
          {/* Einbettbarer KI-Chat für die eigene Website (Bauphase Widget). */}
          <WidgetSnippet
            locale={tenant.defaultLocale}
            host={`${tenant.slug}.hallofhelp.com`}
          />
        </SettingsCard>
      </div>
    </div>
  );
}
