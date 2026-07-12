import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { UploadPlaceholder } from "@/components/admin/settings-bits";

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

  const langOptions = [
    { value: "de", label: "Deutsch" },
    { value: "en", label: "English" },
  ];

  return (
    <div>
      <AdminPageHeader
        title={t("admin.settings.title")}
        subtitle={t("admin.settings.subtitle")}
        action={
          <Button variant="primary" size="sm">
            {t("admin.save")}
          </Button>
        }
      />

      <div className="grid gap-6">
        <SettingsCard title={t("admin.settings.branding")}>
          <div>
            <span className="mb-1.5 block text-sm text-ink-muted">{t("admin.settings.logo")}</span>
            <UploadPlaceholder label={t("admin.settings.uploadLogo")} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <span className="mb-1.5 block text-sm text-ink-muted">
                {t("admin.settings.primaryColor")}
              </span>
              <div className="flex items-center gap-3">
                <span
                  className="h-9 w-9 shrink-0 rounded-comfy border border-hairline"
                  style={{ background: b.colorPrimary }}
                />
                <Input defaultValue={b.colorPrimary} className="w-36 font-mono uppercase" />
              </div>
            </div>
            <div>
              <span className="mb-1.5 block text-sm text-ink-muted">
                {t("admin.settings.accentColor")}
              </span>
              <div className="flex items-center gap-3">
                <span
                  className="h-9 w-9 shrink-0 rounded-comfy border border-hairline"
                  style={{ background: b.colorAccent }}
                />
                <Input defaultValue={b.colorAccent} className="w-36 font-mono uppercase" />
              </div>
            </div>
          </div>
          <div className="max-w-xs">
            <span className="mb-1.5 block text-sm text-ink-muted">
              {t("admin.settings.language")}
            </span>
            <Select
              options={langOptions}
              defaultValue={tenant.defaultLocale}
              aria-label={t("admin.settings.language")}
              className="w-full"
            />
          </div>
          <div className="border-t border-hairline pt-5">
            <Switch label={t("admin.settings.poweredBy")} defaultChecked />
          </div>
        </SettingsCard>

        <SettingsCard title={t("admin.settings.support")}>
          <Input
            label={t("admin.settings.supportEmail")}
            type="email"
            defaultValue={`support@${tenant.slug}.de`}
            className="max-w-md"
          />
          <p className="-mt-2 text-xs text-ink-muted">{t("admin.settings.supportEmailHint")}</p>
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
          <Input
            label={t("admin.settings.customDomain")}
            placeholder={"help.deine-domain.de"}
            className="max-w-md"
          />
          <p className="-mt-2 text-xs text-ink-muted">{t("admin.settings.customDomainHint")}</p>
        </SettingsCard>
      </div>
    </div>
  );
}
