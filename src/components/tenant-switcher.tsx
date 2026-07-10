import { headers } from "next/headers";
import { getTenantSwitchLinks } from "@/lib/tenant/dev-links";

/**
 * Dev-only Tenant-Switcher. Rendert NICHTS in Produktion.
 * Wechseln = Navigation zur Subdomain des anderen Tenants (eigener Origin) → saubere Trennung.
 */
export default async function TenantSwitcher() {
  if (process.env.NODE_ENV === "production") return null;

  const host = (await headers()).get("host");
  const scheme = host?.includes("localhost") ? "http" : "https";
  const links = getTenantSwitchLinks(host, scheme);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/90 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <span className="mr-1 font-semibold text-slate-400">DEV · Tenant</span>
      {links.map((l) => (
        <a
          key={l.slug}
          href={l.url}
          className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
            l.active ? "" : "text-slate-600 hover:bg-slate-100"
          }`}
          style={l.active ? { background: "var(--brand-primary)", color: "var(--brand-primary-fg)" } : undefined}
        >
          {l.name}
        </a>
      ))}
    </div>
  );
}
