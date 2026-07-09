import { getCurrentTenant } from "@/lib/tenant/current";

export default async function Home() {
  const tenant = await getCurrentTenant();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
      <header className="flex items-center gap-3">
        {tenant.branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tenant.branding.logoUrl} alt={tenant.name} className="h-9" />
        ) : (
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg font-bold"
            style={{ background: "var(--brand-primary)", color: "var(--brand-primary-fg)" }}
          >
            {tenant.name.charAt(0)}
          </div>
        )}
        <span className="text-lg font-semibold">{tenant.name}</span>
      </header>

      <section className="rounded-xl border border-slate-200 p-6">
        <h1 className="text-2xl font-bold">White-Label-Grundgerüst steht</h1>
        <p className="mt-2 text-slate-600">
          Diese Oberfläche ist pro Mandant themebar. Aktiver Tenant: <code>{tenant.slug}</code>.
          Farben stammen aus dem Tenant-Branding (CSS-Variablen).
        </p>
        <div className="mt-4 flex gap-3">
          <button
            className="rounded-lg px-4 py-2 font-medium"
            style={{ background: "var(--brand-primary)", color: "var(--brand-primary-fg)" }}
          >
            Primär-Aktion
          </button>
          <button
            className="rounded-lg px-4 py-2 font-medium text-white"
            style={{ background: "var(--brand-accent)" }}
          >
            Akzent
          </button>
        </div>
      </section>

      <p className="text-sm text-slate-500">
        Lokal vergleichen: <code>demo.localhost:3000</code> vs. <code>acme.localhost:3000</code>{" "}
        → unterschiedliches Branding, gleiche Plattform.
      </p>
    </main>
  );
}
