import { Hono } from "hono";
import { requireOwner, requireTeam } from "@/server/auth/guards";
import { isLegalDocType, parseLegalDoc } from "@/server/legal/validate";
import type { ApiDeps, ApiEnv } from "./context";

/**
 * LEGAL-DOCS pro Instanz (Impressum/Datenschutz/AGB — Design h).
 *
 * Admin-Teil (`/admin/legal*`):
 *   - GET    /admin/legal            — requireTeam("admin"): Status-Übersicht
 *       welche der 3 Docs gesetzt sind. NICHT blockierend — fehlende Docs sind
 *       `present:false`, verhindern aber nichts (kein Signup-/Login-Gate).
 *   - PUT    /admin/legal/:docType   — requireOwner: Dokument setzen/ersetzen.
 *   - DELETE /admin/legal/:docType   — requireOwner: Dokument entfernen.
 *
 * ROLLEN-GATING-ENTSCHEIDUNG (bewusst, Design h): Die PFLEGE der Legal-Docs ist
 * an das owner-exklusive Recht `instance:manage-legal` gebunden — `admin` darf
 * LESEN (Übersicht/Banner), aber NICHT schreiben. Rechtsdokumente sind eine
 * instanzweite, haftungsrelevante Owner-Verantwortung. Bei Bedarf ließe sich
 * das Schreiben später auf `admin` lockern (requireOwner → requireTeam("admin")
 * an genau zwei Stellen) — bewusst NICHT vorweggenommen.
 *
 * Public-Teil (`/legal/:docType`, BEWUSST in PUBLIC_ROUTES):
 *   - GET /legal/:docType — Besucher müssen Impressum/Datenschutz OHNE Login
 *     lesen können (rechtliche Pflicht). Liefert das Dokument des per HOST
 *     aufgelösten Tenants als DATEN.
 *
 * XSS-/INJECTION-ABSICHERUNG (Details: legal/validate.ts):
 *   - link:     nur validierte absolute https-URLs (Schema-Whitelist) —
 *               javascript:/data:/http: werden hart abgelehnt.
 *   - markdown: wird als reine Zeichenkette gespeichert UND zurückgegeben,
 *               NIE serverseitig zu HTML gerendert. Ein `<script>` im Markdown
 *               ist damit nur Text. Sicheres Rendern (Roh-HTML deaktiviert) ist
 *               Aufgabe der späteren UI, NICHT dieser API-Schicht.
 *
 * Persistenz über `deps.getLegalDeps()` (D1 der Request-Runtime); ohne Binding
 * → 503 fail-closed. Alle Zugriffe sind über die ID des aufgelösten Tenants
 * gebunden (`WHERE tenant_id = tenant.id`). Fehlercodes sind stabile,
 * maschinenlesbare englische Strings.
 */

export function legalAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  // Status-Übersicht für die Admin-Ansicht (welche Docs fehlen). Lesen genügt
  // admin — bewusst nicht owner-exklusiv (nicht-blockierender Hinweis).
  r.get("/", requireTeam("admin"), async (c) => {
    const legal = await deps.getLegalDeps();
    if (!legal) return c.json({ error: "legal_unavailable" }, 503);
    const docs = await legal.repo.listStatus(c.get("tenant").id);
    return c.json({ docs });
  });

  // Pflege (setzen/ersetzen) — owner-exklusiv (instance:manage-legal).
  r.put("/:docType", requireOwner, async (c) => {
    const docType = c.req.param("docType");
    if (!isLegalDocType(docType)) return c.json({ error: "not_found" }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const parsed = parseLegalDoc(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);

    const legal = await deps.getLegalDeps();
    if (!legal) return c.json({ error: "legal_unavailable" }, 503);

    await legal.repo.upsert(c.get("tenant").id, docType, parsed.value);
    return c.json({ ok: true, docType, mode: parsed.value.mode });
  });

  // Entfernen — owner-exklusiv.
  r.delete("/:docType", requireOwner, async (c) => {
    const docType = c.req.param("docType");
    if (!isLegalDocType(docType)) return c.json({ error: "not_found" }, 404);

    const legal = await deps.getLegalDeps();
    if (!legal) return c.json({ error: "legal_unavailable" }, 503);

    await legal.repo.remove(c.get("tenant").id, docType);
    return c.json({ ok: true });
  });

  return r;
}

export function legalPublicRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.get("/:docType", async (c) => {
    const docType = c.req.param("docType");
    if (!isLegalDocType(docType)) return c.json({ error: "not_found" }, 404);

    const legal = await deps.getLegalDeps();
    if (!legal) return c.json({ error: "legal_unavailable" }, 503);

    // Tenant AUSSCHLIESSLICH aus der Host-Auflösung — nie aus dem Request-Input.
    const doc = await legal.repo.get(c.get("tenant").id, docType);
    if (!doc) return c.json({ error: "not_found" }, 404);

    // Als DATEN ausliefern. Bei markdown: Roh-Text 1:1 (kein serverseitiges
    // HTML-Rendering — siehe Kopfkommentar/validate.ts).
    return c.json(
      doc.mode === "link"
        ? { docType, mode: "link", url: doc.url, updatedAt: doc.updatedAt }
        : { docType, mode: "markdown", markdown: doc.markdown, updatedAt: doc.updatedAt },
    );
  });

  return r;
}
