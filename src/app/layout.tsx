import type { Metadata } from "next";
import "./globals.css";
import { getCurrentTenant } from "@/lib/tenant/current";
import { brandingToStyle } from "@/lib/theme/brand";

export const metadata: Metadata = {
  title: "HallofHelp",
  description: "AI-First Hilfezentrum",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  return (
    <html lang={tenant.defaultLocale} style={brandingToStyle(tenant.branding)}>
      <body className="min-h-screen bg-white text-slate-900 antialiased" data-tenant={tenant.slug}>
        {children}
      </body>
    </html>
  );
}
