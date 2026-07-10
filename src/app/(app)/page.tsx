import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const tenant = await getCurrentTenant();
  // Unbekannter Host: Root-Layout rendert die Not-Found-Shell; hier nichts.
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{t("home.title", { name: tenant.name })}</h1>
        <p className="mt-1 text-ink-muted">{t("home.subtitle")}</p>
      </div>

      <div className="flex gap-3">
        <Button variant="brand">{t("home.primaryAction")}</Button>
        <Button variant="cream">{t("home.accent")}</Button>
      </div>

      <p className="text-sm text-ink-muted">{t("home.switchHint")}</p>
    </div>
  );
}
