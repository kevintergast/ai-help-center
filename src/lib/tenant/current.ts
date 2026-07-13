import { cache } from "react";
import { headers } from "next/headers";
import { resolveTenantSmart } from "@/server/tenant/resolve-tenant";
import type { Tenant } from "./types";

/**
 * Aktuellen Tenant aus dem Request-Host ermitteln (Server Components).
 * Mit `cache()` pro Request dedupliziert → nur eine D1-Abfrage je Request.
 *
 * FAIL-CLOSED: `null` bei unbekanntem Host (mit D1) — das Root-Layout rendert
 * dann eine neutrale Not-Found-Shell; nachgelagerte Layouts/Seiten geben bei
 * `null` einfach nichts zurück (sie werden von Next parallel gerendert und
 * dürfen nie mit einem Fremd-/Demo-Tenant weiterlaufen).
 */
export const getCurrentTenant = cache(async (): Promise<Tenant | null> => {
  const host = (await headers()).get("host");
  return resolveTenantSmart(host);
});
