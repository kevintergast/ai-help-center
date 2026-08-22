import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { requireTeamPage } from "@/server/auth/page-guard";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { ApiKeysManager } from "@/components/admin/api-keys-manager";
import { headers } from "next/headers";

/**
 * ZUGRIFFS-SCHLÜSSEL (MCP/API). Das Admin-Layout gated auf `content`; Schlüssel
 * vergeben Rechte, deshalb hier zusätzlich auf `admin` — dieselbe Schwelle wie
 * die API (api/api-keys.ts). Ohne diese Zeile könnte eine Redaktions-Rolle die
 * Seite öffnen und liefe erst beim Speichern in ein 403.
 */
export default async function AdminApiKeysPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  await requireTeamPage(tenant, "admin");

  // Die MCP-URL ist die Origin DIESER Instanz — jeder Mandant hat seine eigene,
  // weil der Server den Tenant aus dem Host auflöst.
  const host = (await headers()).get("host") ?? `${tenant.slug}.hallofhelp.com`;
  const scheme = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";

  const t = getT(tenant.defaultLocale);
  return (
    <div>
      <AdminPageHeader title={t("admin.apiKeys.title")} subtitle={t("admin.apiKeys.subtitle")} />
      <ApiKeysManager
        locale={tenant.defaultLocale}
        mcpUrl={`${scheme}://${host}/api/v1/mcp`}
      />
    </div>
  );
}
