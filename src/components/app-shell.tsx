import type { Tenant } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { TenantLogo } from "@/components/tenant-logo";

/** Schlanke, pro Tenant gethemte App-Shell (Header + Content). Noch keine Feature-Inhalte. */
export function AppShell({ tenant, children }: { tenant: Tenant; children: React.ReactNode }) {
  const t = getT(tenant.defaultLocale);
  return (
    <div className="flex min-h-screen flex-col">
      {/* Farben ausschließlich über Design-Tokens (funktioniert in Light UND Dark);
          Transluzenz via color-mix, weil die Token-Variablen keine <alpha-value>-Slots haben. */}
      <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-hairline bg-[color-mix(in_srgb,var(--surface)_80%,transparent)] px-6 py-3 backdrop-blur">
        <TenantLogo tenant={tenant} />
        <span className="font-semibold">{tenant.name}</span>
        <span className="ml-auto text-xs uppercase tracking-wide text-ink-muted">
          {t("shell.helpCenter")}
        </span>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
