import type { ReactNode } from "react";
import type { Tenant } from "@/lib/tenant/types";
import { TenantLogo } from "@/components/tenant-logo";

/**
 * Zentriertes Auth-Layout (Punkt 4a-2). Schlicht, tenant-gebrandet: das
 * Tenant-Logo (SSR, aus dem globalen Branding) sitzt über der Auth-Card. Das
 * Branding (CSS-Variablen) liegt bereits global auf <html> (Root-Layout) — hier
 * KEIN zweiter Wrapper. Server-Komponente (keine Interaktivität); die
 * eigentlichen Formulare sind Client-Komponenten als `children`.
 */
export function AuthShell({ tenant, children }: { tenant: Tenant; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-8 px-5 py-12">
      <div className="flex items-center gap-2.5">
        <TenantLogo tenant={tenant} />
      </div>
      <div className="w-full">{children}</div>
    </main>
  );
}
