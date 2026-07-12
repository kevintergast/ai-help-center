import { notFound } from "next/navigation";
import { getCurrentTenant } from "@/lib/tenant/current";
import { OPERATOR_TENANT_ID } from "@/lib/tenant/resolve";
import { OperatorShell } from "@/components/operator/operator-shell";

/**
 * Operator-Konsole (Punkt 4b) — NUR auf der Betreiber-Instanz
 * (`app.hallofhelp.app` → `t_operator`). Auf jedem Kunden-Host ist `/console`
 * fail-closed nicht vorhanden (`notFound()`), damit die Control-Plane nirgends
 * sonst erscheint. Das Session-Gate sitzt in der Seite selbst (Anmelde-Prompt
 * statt echter Daten), weil Operator-Konten normale `user` sind (kein Team-Gate,
 * keine MFA-Pflicht im MVP).
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  if (tenant.id !== OPERATOR_TENANT_ID) notFound();
  return <OperatorShell locale={tenant.defaultLocale}>{children}</OperatorShell>;
}
