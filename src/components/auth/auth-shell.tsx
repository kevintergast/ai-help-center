import type { ReactNode } from "react";
import { OPERATOR_TENANT_ID } from "@/lib/tenant/resolve";
import type { Tenant } from "@/lib/tenant/types";
import { BrandMark } from "@/components/brand-mark";
import { TenantLogo } from "@/components/tenant-logo";

/**
 * Zentriertes Auth-Layout (Punkt 4a-2). Schlicht, tenant-gebrandet: über der
 * Auth-Card sitzt auf der OPERATOR-Instanz die Hall-Of-Help-BILDMARKE
 * (User-Vorgabe 2026-07-16 — nicht der Initial-Fallback), auf Kunden-
 * Instanzen das Tenant-Logo (White-Label, SSR aus dem globalen Branding).
 * Das Branding (CSS-Variablen) liegt bereits global auf <html> (Root-Layout)
 * — hier KEIN zweiter Wrapper. Server-Komponente (keine Interaktivität); die
 * eigentlichen Formulare sind Client-Komponenten als `children`.
 */
export function AuthShell({ tenant, children }: { tenant: Tenant; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-8 px-5 py-12">
      <div className="flex items-center gap-2.5">
        {tenant.id === OPERATOR_TENANT_ID ? (
          <BrandMark className="h-12 w-12" />
        ) : (
          <TenantLogo tenant={tenant} />
        )}
      </div>
      <div className="w-full">{children}</div>
    </main>
  );
}
