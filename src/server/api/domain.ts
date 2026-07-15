import { Hono } from "hono";
import { requireOwner, requireTeam } from "@/server/auth/guards";
import { normalizeCustomDomain, txtRecordName } from "@/server/domains/validate";
import { newVerificationToken } from "@/server/domains/verify";
import type { ApiDeps, ApiEnv } from "./context";

/**
 * CUSTOM-DOMAIN-ADMIN-API (Infra-Plan Schritt 5) — `/admin/domain*`.
 *
 *   - GET    /admin/domain         — Status + TXT-Anleitung (requireTeam("admin"))
 *   - PUT    /admin/domain         — Domain beanspruchen → pending + frisches Token (owner)
 *   - POST   /admin/domain/verify  — TXT-Check; Erfolg → verified + SaaS-Provisioning (owner)
 *   - DELETE /admin/domain         — Claim lösen (owner)
 *
 * GATING: Mutationen sind OWNER-exklusiv (wie Legal, Design h) — ein Domain-
 * Wechsel lenkt die gesamte Instanz um. SICHERHEIT: die Auflösung nutzt
 * weiterhin NUR status='verified' (Join im Tenant-Resolver, fail-closed) —
 * eine beanspruchte, unverifizierte Domain bleibt wirkungslos. Eine Domain ist
 * global nur EINMAL beanspruchbar (UNIQUE-Index; Hijack-Schutz). Der 409 bei
 * fremd-beanspruchter Domain ist ein bewusstes, mildes Orakel (wie
 * subdomain-available) — ohne ihn wäre der Flow unbedienbar.
 */

export function domainAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();
  const nowSec = () => Math.floor(Date.now() / 1000);

  r.get("/", requireTeam("admin"), async (c) => {
    const domains = await deps.getDomainDeps?.();
    if (!domains) return c.json({ error: "domain_unavailable" }, 503);

    const claim = await domains.repo.getForTenant(c.get("tenant").id);
    if (!claim) return c.json({ claim: null });
    return c.json({
      claim: {
        domain: claim.domain,
        status: claim.status,
        verifiedAt: claim.verifiedAt,
        lastCheckedAt: claim.lastCheckedAt,
        txtRecordName: txtRecordName(claim.domain),
        txtRecordValue: claim.verificationToken,
      },
    });
  });

  r.put("/", requireOwner, async (c) => {
    const domains = await deps.getDomainDeps?.();
    if (!domains) return c.json({ error: "domain_unavailable" }, 503);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = normalizeCustomDomain((body as { domain?: unknown })?.domain);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const token = newVerificationToken();
    const result = await domains.repo.claim(c.get("tenant").id, parsed.domain, token, nowSec());
    if (result === "domain_taken") return c.json({ error: "domain_taken" }, 409);

    return c.json({
      ok: true,
      status: "pending",
      domain: parsed.domain,
      txtRecordName: txtRecordName(parsed.domain),
      txtRecordValue: token,
    });
  });

  r.post("/verify", requireOwner, async (c) => {
    const domains = await deps.getDomainDeps?.();
    if (!domains) return c.json({ error: "domain_unavailable" }, 503);

    const tenantId = c.get("tenant").id;
    const claim = await domains.repo.getForTenant(tenantId);
    if (!claim) return c.json({ error: "not_found" }, 404);
    if (claim.status === "verified") {
      // Idempotent: erneutes Verify stößt nur das Provisioning nochmal an
      // (z. B. nachdem der SaaS-Token nachgereicht wurde).
      return c.json({ ok: true, status: "verified", provisioning: await domains.provision(claim.domain) });
    }

    const result = await domains.checkTxt(claim.domain, claim.verificationToken);
    if (result !== "verified") {
      await domains.repo.touchChecked(tenantId, claim.domain, nowSec());
      const code =
        result === "not_found" ? "txt_not_found" : result === "mismatch" ? "txt_mismatch" : "dns_error";
      return c.json({ error: code }, 409);
    }

    const marked = await domains.repo.markVerified(tenantId, claim.domain, nowSec());
    if (!marked) return c.json({ error: "not_found" }, 404);

    // Best-effort: Verifikation gilt auch, wenn das SaaS-Provisioning (noch)
    // nicht konfiguriert ist — die UI zeigt den Provisioning-Stand an.
    const provisioning = await domains.provision(claim.domain);
    return c.json({ ok: true, status: "verified", provisioning });
  });

  r.delete("/", requireOwner, async (c) => {
    const domains = await deps.getDomainDeps?.();
    if (!domains) return c.json({ error: "domain_unavailable" }, 503);
    await domains.repo.release(c.get("tenant").id);
    return c.json({ ok: true });
  });

  return r;
}
