import { Hono } from "hono";
import { requireTeam } from "@/server/auth/guards";
import { logoKeyFor, parseLogoVariant } from "@/server/branding/store";
import {
  ALLOWED_FAVICON_TYPES,
  ALLOWED_LOGO_TYPES,
  MAX_LOGO_BYTES,
  canonicalImageType,
  parseBrandingColors,
  sniffIconType,
} from "@/server/branding/validate";
import type { ApiDeps, ApiEnv } from "./context";

/**
 * BRANDING-ROUTEN (White-Label pflegbar machen).
 *
 * Admin-Teil (`/admin/branding*`, requireTeam("admin")):
 *   - PUT  /admin/branding       — Farben (strikt Hex-validiert, siehe validate.ts)
 *   - POST /admin/branding/logo  — Logo-Upload (roher Body) nach R2
 *   - DELETE /admin/branding/logo — Logo entfernen (R2 + Spalten)
 *
 * LOGO-VARIANTEN (0023/0031): `?variant=dark` adressiert das Dark-Mode-Logo
 * (Spalte logo_dark_r2_key), `?variant=favicon` das Tab-Icon der Instanz
 * (favicon_r2_key); alles andere/fehlend = helles Logo. Beide Zusatz-Slots
 * sind optional: ohne dunkles Logo zeigt das UI im Dark Mode das helle
 * (tenant-logo.tsx), ohne Favicon dient das helle Logo als Tab-Icon
 * (faviconUrlFor in lib/theme/brand.ts).
 *
 * Public-Teil (`/branding/logo`, BEWUSST in PUBLIC_ROUTES):
 *   - GET /branding/logo         — Logo des AKTUELLEN Tenants ausliefern.
 *     Das Hilfezentrum ist öffentlich; das Logo muss ohne Session laden
 *     (erster Paint, Widget). Der R2-Key kommt IMMER aus der DB-Zeile des
 *     per Host aufgelösten Tenants — nie aus User-Input → kein Pfad, über
 *     den fremde R2-Objekte adressierbar wären.
 *
 * Upload-Härtung (Reihenfolge: billige Checks zuerst):
 *   1. Content-Type-Allowlist: image/png|jpeg|webp, fürs Favicon zusätzlich
 *      image/x-icon. SVG ist BEWUSST verboten (Script-Injection/XSS —
 *      Begründung in validate.ts).
 *   2. Größe: Content-Length-Header UND tatsächliche Bytes ≤ 1 MB.
 *   3. Magic Bytes müssen den deklarierten Content-Type bestätigen —
 *      die Client-Angabe allein ist nur eine Behauptung.
 *
 * Persistenz über `deps.getBrandingDeps()` (D1 + R2 der Request-Runtime);
 * ohne Bindings → 503 fail-closed. Alle Schreibzugriffe sind über die ID des
 * aufgelösten Tenants gebunden (WHERE id = tenant.id / fester R2-Key).
 * Antworten sind stabile, maschinenlesbare JSON-Codes (Englisch).
 */

export function brandingAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.put("/", requireTeam("admin"), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const colors = parseBrandingColors(body);
    if (!colors) return c.json({ error: "invalid_color" }, 400);

    const branding = await deps.getBrandingDeps();
    if (!branding) return c.json({ error: "branding_unavailable" }, 503);

    await branding.repo.updateColors(c.get("tenant").id, colors);
    return c.json({ ok: true, branding: colors });
  });

  r.post("/logo", requireTeam("admin"), async (c) => {
    // Variante zuerst: sie entscheidet über die erlaubten Formate (ICO nur
    // fürs Favicon) — und ist reine Whitelist, kein User-Input im R2-Key.
    const variant = parseLogoVariant(c.req.query("variant"));
    const allowed: readonly string[] =
      variant === "favicon" ? ALLOWED_FAVICON_TYPES : ALLOWED_LOGO_TYPES;

    const contentType = canonicalImageType(
      (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase(),
    );
    if (!allowed.includes(contentType)) {
      return c.json({ error: "unsupported_media_type" }, 415);
    }

    // Früher Abbruch anhand des Headers; die echte Größe wird danach erneut
    // geprüft (der Header ist Client-Angabe, nicht Wahrheit).
    const declared = Number(c.req.header("content-length"));
    if (Number.isFinite(declared) && declared > MAX_LOGO_BYTES) {
      return c.json({ error: "payload_too_large" }, 413);
    }

    const data = await c.req.arrayBuffer();
    if (data.byteLength > MAX_LOGO_BYTES) return c.json({ error: "payload_too_large" }, 413);

    // Magic Bytes müssen die Behauptung des Clients bestätigen; für den
    // Logo-Slot liefert sniffIconType nie "image/x-icon" durch, weil dieser
    // Typ dort schon an der Allowlist gescheitert wäre.
    const sniffed = sniffIconType(new Uint8Array(data));
    if (sniffed !== contentType) return c.json({ error: "invalid_image" }, 400);

    const branding = await deps.getBrandingDeps();
    if (!branding) return c.json({ error: "branding_unavailable" }, 503);

    const tenantId = c.get("tenant").id;
    const key = logoKeyFor(tenantId, variant); // fester Key pro Tenant+Variante → Upload überschreibt
    await branding.bucket.put(key, data, { httpMetadata: { contentType: sniffed } });
    await branding.repo.setLogoKey(tenantId, variant, key);
    return c.json({ ok: true, variant });
  });

  r.delete("/logo", requireTeam("admin"), async (c) => {
    const branding = await deps.getBrandingDeps();
    if (!branding) return c.json({ error: "branding_unavailable" }, 503);

    const tenantId = c.get("tenant").id;
    const variant = parseLogoVariant(c.req.query("variant"));
    await branding.bucket.delete(logoKeyFor(tenantId, variant));
    await branding.repo.clearLogoKey(tenantId, variant);
    return c.json({ ok: true, variant });
  });

  return r;
}

export function brandingPublicRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.get("/logo", async (c) => {
    const branding = await deps.getBrandingDeps();
    if (!branding) return c.json({ error: "branding_unavailable" }, 503);

    // Key ausschließlich aus der DB-Zeile des per Host aufgelösten Tenants;
    // die Variante wählt nur zwischen den festen Bild-Spalten dieses Tenants.
    const variant = parseLogoVariant(c.req.query("variant"));
    const key = await branding.repo.getLogoKey(c.get("tenant").id, variant);
    if (!key) return c.json({ error: "not_found" }, 404);

    const obj = await branding.bucket.get(key);
    if (!obj) return c.json({ error: "not_found" }, 404);

    // Aggressiv cachen: die URL trägt ?v=<branding_updated_at> (Cache-Buster),
    // der Inhalt hinter EINER Versions-URL ändert sich nie → immutable.
    return c.body(obj.body, 200, {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      // Sniffing hart verbieten: selbst ein Polyglott (gültiger Bild-Header,
      // dahinter HTML) darf nie als Dokument interpretiert werden.
      "x-content-type-options": "nosniff",
      "content-disposition": 'inline; filename="logo"',
    });
  });

  return r;
}
