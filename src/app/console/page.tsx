import { getCurrentTenant } from "@/lib/tenant/current";
import { getTurnstileSiteKey } from "@/lib/turnstile";
import { readOperatorPageUser } from "@/server/operator/page-guard";
import { OperatorConsole } from "@/components/operator/operator-console";

/**
 * Einstieg der Operator-Konsole: löst den (Operator-)Tenant + die aktuelle
 * Operator-Session serverseitig auf und übergibt nur den eingeloggt-Zustand an
 * die Client-Konsole. Diese lädt „meine Hilfezentren" tenant-/operator-scoped
 * über die API (kein Cross-Tenant-Zugriff im UI). Kontext-Gate: Layout.
 */
export default async function ConsolePage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const user = await readOperatorPageUser(tenant);
  return (
    <OperatorConsole
      locale={tenant.defaultLocale}
      signedIn={!!user}
      turnstileSiteKey={await getTurnstileSiteKey()}
    />
  );
}
