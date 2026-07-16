import type { Metadata } from "next";
import "./globals.css";
import { getCurrentTenant } from "@/lib/tenant/current";
import { brandingToStyle } from "@/lib/theme/brand";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { getT } from "@/i18n/t";
import { getAppEnv } from "@/lib/env";
import { EnvMarker } from "@/components/env-marker";

// White-Label: Titel/Description kommen pro Request aus dem Tenant (Host →
// getCurrentTenant, via React cache() dedupliziert → keine zweite D1-Query).
// Kein statisches `metadata`-Export, sonst stünde der Plattformname im Tab
// JEDES Mandanten.
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return {
      title: getT(DEFAULT_LOCALE)("tenantNotFound.title"),
      applicationName: "Hall Of Help",
      robots: { index: false },
    };
  }
  const t = getT(tenant.defaultLocale);
  return {
    // Tab-Titel bleibt pro Tenant (White-Label); applicationName ist die
    // Plattform-Identität (PWA/Browser-Metadaten).
    title: {
      default: tenant.name,
      template: `%s · ${tenant.name}`,
    },
    applicationName: "Hall Of Help",
    description: t("meta.description", { name: tenant.name }),
    // SEO-Opt-out (Migration 0013): noindex auf JEDER Seite der Instanz —
    // de-indexiert auch bereits aufgenommene URLs (robots.txt allein täte
    // das nicht). Default (true/undefined) setzt bewusst NICHTS.
    ...(tenant.seoIndexable === false ? { robots: { index: false, follow: false } } : {}),
  };
}

// Setzt das gespeicherte Theme VOR dem Paint (verhindert Flash).
const themeScript = `try{var t=localStorage.getItem('hh-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  const appEnv = await getAppEnv();

  // FAIL-CLOSED: unbekannter Host → neutrale Not-Found-Shell OHNE jedes
  // Tenant-Branding (kein Demo-Logo, keine fremden Farben, kein data-tenant).
  // {children} wird bewusst nicht gerendert; nachgelagerte Layouts/Seiten
  // geben bei tenant=null ohnehin nichts zurück.
  if (!tenant) {
    const t = getT(DEFAULT_LOCALE);
    return (
      <html lang={DEFAULT_LOCALE} suppressHydrationWarning>
        <body className="min-h-screen bg-surface font-sans text-ink antialiased">
          <EnvMarker env={appEnv} />
          <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
            <h1 className="text-xl font-bold">{t("tenantNotFound.title")}</h1>
            <p className="text-ink-muted">{t("tenantNotFound.body")}</p>
          </main>
        </body>
      </html>
    );
  }

  return (
    // Tenant-Branding als Inline-Style aufs <html>: serverseitig gerendert →
    // der ERSTE Paint hat bereits die Mandanten-Farben (kein FOUC, kein
    // Client-Fetch). Zur Dark-Mode-Interaktion siehe brandingToStyle (brand.ts).
    <html lang={tenant.defaultLocale} style={brandingToStyle(tenant.branding)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className="min-h-screen bg-surface font-sans text-ink antialiased"
        data-tenant={tenant.slug}
      >
        <EnvMarker env={appEnv} />
        {children}
      </body>
    </html>
  );
}
