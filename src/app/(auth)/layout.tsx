import { getCurrentTenant } from "@/lib/tenant/current";
import { AuthShell } from "@/components/auth/auth-shell";

/**
 * Layout der Auth-Journey (/login, /signup, /verify-email, /forgot-password,
 * /reset-password, /mfa/*, /invite/accept). Rendert die zentrierte Auth-Shell
 * mit Tenant-Logo; das Branding (CSS-Variablen) liegt global auf <html>
 * (Root-Layout). Unbekannter Host → Root-Layout zeigt die Not-Found-Shell,
 * hier nichts.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  return <AuthShell tenant={tenant}>{children}</AuthShell>;
}
