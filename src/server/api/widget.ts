import { Hono } from "hono";
import type { ApiDeps, ApiEnv } from "./context";

/**
 * ÖFFENTLICHE WIDGET-ROUTEN.
 *
 * Der frühere Bootstrap `GET /widget/session` ist ERSATZLOS entfallen: Er
 * existierte nur, um dem Cross-Site-iframe eine Besucher-Kennung zu geben,
 * die es weder als Third-Party-Cookie halten noch selbst erfinden durfte.
 * Seit die ID serverseitig aus Adresse + User-Agent + Periode abgeleitet wird
 * (security/visitor-id.ts), braucht das Widget gar keine Kennung mehr — und
 * bekommt nebenbei DIESELBE ID wie das Hilfezentrum, was vorher am
 * Third-Party-Riegel scheiterte.
 */
export function widgetPublicRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  /**
   * ERSCHEINUNGSBILD (0041) für den Loader.
   *
   * WARUM EIN ENDPUNKT statt Werten im Loader-Skript: `widget.js` ist bewusst
   * ein STATISCHER, cachebarer String ohne Nutzer-Input (kein XSS-Vektor,
   * siehe app/widget.js). Würde es die Einstellungen einbetten, wäre es je
   * Instanz verschieden und müsste bei jeder Änderung neu ausgeliefert werden.
   * So bleibt das Skript unverändert und holt sich den Rest.
   *
   * PUBLIC: Es sind genau die Angaben, die ohnehin jeder sieht, sobald das
   * Widget auf der Kundenseite steht — Farbe, Beschriftung, Symbol-Adressen.
   */
  r.get("/config", async (c) => {
    const tenant = c.get("tenant");
    return c.json({
      variant: tenant.widget?.variant ?? "colored",
      label: tenant.widget?.label ?? null,
      iconUrl: tenant.widget?.iconUrl ?? null,
      iconOpenUrl: tenant.widget?.iconOpenUrl ?? null,
      color: tenant.branding.colorPrimary,
      colorFg: tenant.branding.colorPrimaryFg,
    });
  });

  return r;
}
