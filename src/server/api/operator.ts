import { Hono } from "hono";
import type { Context } from "hono";
import { OPERATOR_TENANT_ID } from "@/lib/tenant/resolve";
import type { Locale, Tenant } from "@/lib/tenant/types";
import { canonicalizeEmail } from "@/server/auth/email";
import { enforceSessionTenant } from "@/server/auth/session-guard";
import type { NewHelpCenter } from "@/server/operator/repository";
import { checkSlug, parseHelpCenterInput } from "@/server/operator/validate";
import type { ApiDeps, ApiEnv } from "./context";
import { allowRequest, clientIp, rateLimited } from "./rate-limit";

/**
 * OPERATOR-ROUTEN (Punkt 4b): Provisioning der Betreiber-Control-Plane auf
 * `app.hallofhelp.com`.
 *
 * ENDPUNKTE (alle NUR im Operator-Kontext + nur für eingeloggte Operator-Konten):
 *   GET  /operator/subdomain-available?slug=  — Format/Reserviert/Kollision
 *   POST /operator/help-centers               — neues Hilfezentrum provisionieren
 *   GET  /operator/help-centers               — eigene Hilfezentren listen
 *
 * KONTEXT-GATE (fail-closed): jede Route prüft zuerst, dass der aufgelöste Tenant
 * die Operator-Instanz (`t_operator`) ist — sonst 404 (die Route „existiert" auf
 * Kunden-Hosts nicht). Die Session-Pflicht kommt aus der Default-Deny-Middleware
 * (KEIN public-routes-Eintrag); zusätzlich wird die Session hier erneut als
 * operator-tenant-gebunden gelesen (Defense-in-Depth).
 *
 * ISOLATION: Operator-Konto (in `t_operator`) und die erzeugten Tenant-Owner
 * sind GETRENNTE Konten. Ein Operator sieht/erstellt NUR eigene Hilfezentren
 * (Mapping `operator_help_centers`, gelesen über die eigene Session-User-Id).
 * Die Owner-Rolle wird hier direkt+kontrolliert vergeben (NIE per Einladung).
 */

const OPERATOR_UNAVAILABLE = { error: "operator_unavailable" } as const;
const UNAUTHORIZED = { error: "unauthorized" } as const;

/** Abuse-Cap: max. Hilfezentren pro Operator-Konto (Erhöhung später pro Plan). */
export const MAX_HELP_CENTERS_PER_ACCOUNT = 5;
const NOT_FOUND = { error: "not_found" } as const;

/** Session-User-Auszug, den die Operator-Routen benötigen. */
interface OperatorUser {
  id: string;
  email: string;
  name?: string | null;
  emailVerified?: boolean | null;
}

interface OperatorSessionData {
  session: { tenantId?: string | null };
  user: OperatorUser;
}

/** Ist der aufgelöste Tenant die Operator-Instanz? Sonst 404 (fail-closed). */
function ensureOperatorContext(c: Context<ApiEnv>): Response | null {
  if (c.get("tenant").id !== OPERATOR_TENANT_ID) return c.json(NOT_FOUND, 404);
  return null;
}

/** Session-User (operator-tenant-gebunden) lesen. Fail-closed: null bei Fehler. */
async function readOperatorUser(c: Context<ApiEnv>): Promise<OperatorUser | null> {
  try {
    const auth = await c.get("getAuth")();
    const data = (await auth.api.getSession({
      headers: c.req.raw.headers,
    })) as OperatorSessionData | null;
    if (!data || !enforceSessionTenant(data.session)) return null;
    return data.user;
  } catch {
    return null;
  }
}

/** Neuen Tenant als Domänen-Objekt bauen (für den Owner-Setup-Versand). */
function newTenantObject(input: NewHelpCenter): Tenant {
  return {
    id: input.tenantId,
    slug: input.slug,
    name: input.name,
    customDomain: null,
    defaultLocale: input.defaultLocale as Locale,
    branding: {
      logoUrl: null,
      colorPrimary: input.colorPrimary ?? "#4f46e5",
      colorAccent: input.colorAccent ?? "#06b6d4",
      colorPrimaryFg: "#ffffff",
    },
  };
}

export function operatorRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  // Verfügbarkeit einer Wunsch-Subdomain: Format → Reserviert → Kollision.
  r.get("/subdomain-available", async (c) => {
    const ctxErr = ensureOperatorContext(c);
    if (ctxErr) return ctxErr;

    const user = await readOperatorUser(c);
    if (!user) return c.json(UNAUTHORIZED, 401);

    const slug = c.req.query("slug");
    const rejection = checkSlug(slug);
    if (rejection) return c.json({ available: false, reason: rejection });

    const operator = await deps.getOperatorDeps?.();
    if (!operator) return c.json(OPERATOR_UNAVAILABLE, 503);

    const taken = await operator.repo.isSlugTaken(slug as string);
    return c.json(taken ? { available: false, reason: "taken" } : { available: true });
  });

  // Neues Hilfezentrum provisionieren (Tenant + Owner-Konto + Mapping).
  r.post("/help-centers", async (c) => {
    const ctxErr = ensureOperatorContext(c);
    if (ctxErr) return ctxErr;

    // IP-Notbremse (5/min) VOR Turnstile/Body-Arbeit — Provisionierung ist
    // der teuerste Self-Service-Schreibpfad (Tenant + Konto + Mail).
    if (!(await allowRequest(deps.rateLimiters?.sensitive, `create:${clientIp(c)}`))) {
      return rateLimited(c);
    }

    // TURNSTILE (Infra-Plan Schritt 2): Tenant-Erstellung ist der teuerste
    // Self-Service-Pfad → Bot-Gate VOR jeder weiteren Arbeit. Fehlender Prüfer
    // = „unavailable" (503, fail-closed) — NIE Bypass. Semantik-Matrix
    // (Secret×Umgebung): security/turnstile.ts.
    const verdict = await (deps.verifyTurnstile
      ? deps.verifyTurnstile(
          c.req.header("x-captcha-response") ?? null,
          c.req.header("cf-connecting-ip") ?? null,
        )
      : Promise.resolve("unavailable" as const));
    if (verdict === "missing") return c.json({ error: "captcha_required" }, 400);
    if (verdict === "failed") return c.json({ error: "captcha_failed" }, 403);
    if (verdict === "unavailable") return c.json({ error: "captcha_unavailable" }, 503);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = parseHelpCenterInput(body);
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);

    const operator = await deps.getOperatorDeps?.();
    if (!operator) return c.json(OPERATOR_UNAVAILABLE, 503);

    const user = await readOperatorUser(c);
    if (!user) return c.json(UNAUTHORIZED, 401);
    // Nur ein e-mail-verifizierter Operator darf provisionieren — die
    // email_verified=1-Ableitung des Owner-Kontos hängt an dieser Verifikation.
    if (user.emailVerified !== true) {
      return c.json({ error: "operator_email_unverified" }, 403);
    }

    // ABUSE-CAP: Hilfezentren pro Operator-Konto gedeckelt (ein verifiziertes
    // Konto darf die Plattform nicht mit Instanzen fluten — jede Instanz
    // kostet D1-Zeilen, eine Subdomain und eine Owner-Mail). Erhöhung später
    // bewusst pro Kunde/Plan.
    if ((await operator.repo.countByOperator(user.id)) >= MAX_HELP_CENTERS_PER_ACCOUNT) {
      return c.json({ error: "help_center_limit_reached" }, 409);
    }

    // Vor-Check für einen präzisen 409 — autoritativ ist der UNIQUE-Index im
    // batch() (createHelpCenter), der ein TOCTOU-Race abfängt.
    if (await operator.repo.isSlugTaken(parsed.slug)) {
      return c.json({ error: "slug_taken" }, 409);
    }

    // SAME-CREDENTIALS-KOMFORT (Entscheidung 2026-07-16): Das Owner-Konto der
    // neuen Instanz startet mit den Zugangsdaten des Operator-Kontos (Passwort-
    // Hash + ggf. TOTP, einmalige Kopie beim Provisionieren — Details/Grenzen in
    // repository.ts). Social-only-Operatoren (kein credential) → Setup-Mail.
    const ownerCredential = await operator.repo.getOwnerCredentialTemplate(
      OPERATOR_TENANT_ID,
      user.id,
    );

    const input: NewHelpCenter = {
      tenantId: `t_${crypto.randomUUID()}`,
      slug: parsed.slug,
      name: parsed.name,
      defaultLocale: parsed.defaultLocale,
      colorPrimary: parsed.colorPrimary,
      colorAccent: parsed.colorAccent,
      operatorUserId: user.id,
      ownerUserId: crypto.randomUUID(),
      ownerEmail: canonicalizeEmail(user.email),
      ownerName: user.name ?? null,
      ownerCredential,
    };

    const result = await operator.repo.createHelpCenter(input);
    if (result === "slug_taken") return c.json({ error: "slug_taken" }, 409);

    // Owner-Zugang: mit kopierten Zugangsdaten ist KEINE Setup-Mail nötig
    // (gleiches Passwort + gleiche Authenticator-App); nur im Fallback läuft
    // der Set-Passwort-Flow. Best-Effort: ein Versandfehler nimmt das
    // Provisioning NICHT zurück.
    const tenant = newTenantObject(input);
    const setup = ownerCredential
      ? null
      : await operator.sendOwnerSetup({ tenant, ownerEmail: input.ownerEmail });

    return c.json(
      {
        tenantId: input.tenantId,
        slug: input.slug,
        name: input.name,
        defaultLocale: input.defaultLocale,
        helpCenterUrl: `https://${input.slug}.hallofhelp.com`,
        // Steuert die Erfolgs-Copy der Console (gleiche Zugangsdaten vs. Mail).
        ownerAccess: ownerCredential ? "same_credentials" : "setup_mail",
        // dev-only (kein Mail-Key, NODE_ENV != prod): Set-Passwort-Link inline.
        ...(setup?.devLink ? { ownerSetupDevLink: setup.devLink } : {}),
      },
      201,
    );
  });

  // Eigene Hilfezentren (nur die vom eingeloggten Operator-Konto erstellten).
  r.get("/help-centers", async (c) => {
    const ctxErr = ensureOperatorContext(c);
    if (ctxErr) return ctxErr;

    const user = await readOperatorUser(c);
    if (!user) return c.json(UNAUTHORIZED, 401);

    const operator = await deps.getOperatorDeps?.();
    if (!operator) return c.json(OPERATOR_UNAVAILABLE, 503);

    const helpCenters = await operator.repo.listByOperator(user.id);
    return c.json({
      helpCenters: helpCenters.map((h) => ({
        tenantId: h.tenantId,
        slug: h.slug,
        name: h.name,
        defaultLocale: h.defaultLocale,
        createdAt: h.createdAt,
        helpCenterUrl: `https://${h.slug}.hallofhelp.com`,
      })),
    });
  });

  return r;
}
