import Link from "next/link";
import { getCurrentTenant } from "@/lib/tenant/current";
import { getT } from "@/i18n/t";
import { listDestinations } from "@/server/content/runtime";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { Card } from "@/components/ui/card";

/**
 * ZIEL-ÜBERSICHT — jede hinterlegte Oberfläche genau einmal.
 *
 * Ziele werden INLINE am Abschnitt gepflegt, dort wo der Schritt steht. Das
 * ist beim Schreiben richtig, hat aber einen Preis: Dieselbe Seite taucht in
 * vielen Artikeln auf. Ändert sich eine Produkt-Adresse, wäre sie sonst über
 * achtzig Artikel verteilt zu suchen.
 *
 * Diese Seite ändert NICHTS — sie zeigt nur, wo etwas steht, und verlinkt
 * dorthin. Ein Sammel-Ersetzen wäre die naheliegende Erweiterung, aber es
 * würde Artikel verändern, ohne dass jemand den Zusammenhang gesehen hat.
 * Erst sehen, dann ändern.
 *
 * Das Admin-Layout gated bereits auf `content` — dieselbe Schwelle wie die
 * Artikelpflege, also kein zusätzliches Gate hier.
 */
export default async function AdminDestinationsPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const t = getT(tenant.defaultLocale);
  const destinations = await listDestinations(tenant);

  return (
    <div>
      <AdminPageHeader
        title={t("admin.destinations.title")}
        subtitle={t("admin.destinations.subtitle")}
      />

      {destinations.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">{t("admin.destinations.empty")}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {destinations.map((d) => (
            <Card key={d.href}>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <code className="break-all font-mono text-sm text-ink">{d.href}</code>
                <span className="shrink-0 text-xs text-ink-muted">
                  {t("admin.destinations.usedIn", { n: String(d.uses.length) })}
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {d.uses.map((u, i) => (
                  <li key={`${u.articleId}-${i}`} className="border-t border-hairline pt-2">
                    <Link
                      href={`/admin/articles/${u.articleId}`}
                      className="text-sm text-brand hover:underline"
                    >
                      {u.title}
                    </Link>
                    {/* Die Beschreibung steht hier, weil sich an ihr beurteilen
                        lässt, ob zwei Verweise WIRKLICH dieselbe Seite meinen
                        — oder jemand eine Adresse zweckentfremdet hat. */}
                    <p className="mt-0.5 text-xs text-ink-muted">{u.purpose}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
