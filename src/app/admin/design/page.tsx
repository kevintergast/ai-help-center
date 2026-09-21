import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { ThemeGenerator } from "@/components/admin/theme-generator";

/**
 * FARBWELT (0045) — eigene Seite, nicht eine weitere Karte in den
 * Einstellungen: Der Generator braucht eine Vorschau neben den Reglern, und
 * eine Vorschau in einer Einstellungs-Karte wäre ein Briefmarkenbild.
 *
 * Das Admin-Layout gated bereits auf Team-Zugehörigkeit; die schreibende
 * Route (PUT/DELETE /admin/settings/theme) verlangt `admin` — wie das
 * Branding daneben, denn es ist dieselbe Art Entscheidung.
 */
export default async function AdminDesignPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);

  return (
    <div>
      <AdminPageHeader title={t("admin.theme.title")} subtitle={t("admin.theme.subtitle")} />
      <ThemeGenerator
        locale={tenant.defaultLocale}
        branding={tenant.branding}
        initial={tenant.theme ?? null}
      />
    </div>
  );
}
