import { headers } from "next/headers";
import { resolveTenant } from "./resolve";
import type { Tenant } from "./types";

/** Aktuellen Tenant aus dem Request-Host ermitteln (Server Components / Route Handlers). */
export async function getCurrentTenant(): Promise<Tenant> {
  const host = (await headers()).get("host");
  return resolveTenant(host);
}
