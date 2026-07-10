import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Genau EINE Tenant-Quelle pro Request. Wird am äußersten Boundary via
 * `runWithTenant(...)` gesetzt; Adapter/Auth-Factory lesen denselben Wert.
 * Fail-closed: außerhalb eines Kontexts gibt es keine „Default"-Instanz.
 */
interface TenantCtx {
  tenantId: string;
}

const als = new AsyncLocalStorage<TenantCtx>();

export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  if (!tenantId) throw new Error("runWithTenant: tenantId fehlt");
  return als.run({ tenantId }, fn);
}

export function currentTenantId(): string | null {
  return als.getStore()?.tenantId ?? null;
}

export function currentTenantIdOrThrow(): string {
  const id = currentTenantId();
  if (!id) throw new Error("Kein Tenant-Kontext (fail-closed)");
  return id;
}
