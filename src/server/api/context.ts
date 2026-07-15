import type { betterAuth } from "better-auth";
import type { Tenant } from "@/lib/tenant/types";
import type { AuditRepository } from "@/server/auth/audit";
import type { BillingDeps } from "@/server/billing/store";
import type { InvitationRepository } from "@/server/auth/invitations";
import type { OAuthGatewayDeps } from "@/server/auth/oauth-gateway";
import type { InvitationEmailData } from "@/server/auth/resend";
import type { TeamUserRepository } from "@/server/auth/team-users";
import type { BrandingDeps } from "@/server/branding/store";
import type { ContentDeps } from "@/server/content/store";
import type { LegalDeps } from "@/server/legal/store";
import type { OperatorRepository } from "@/server/operator/repository";
import type { OwnerSetupResult } from "@/server/operator/onboarding";
import type { TurnstileVerify } from "@/server/security/turnstile";
import type { AskInput, AskOutcome } from "@/server/rag/ask";
import type { CustomHostnameProvisioner } from "@/server/domains/provisioner";
import type { DomainRepository } from "@/server/domains/store";
import type { TxtChecker } from "@/server/domains/verify";
import type { Tenant as OperatorTenant } from "@/lib/tenant/types";

/**
 * Gemeinsame Typen der API-Schicht (Hono-Context, injizierbare Deps).
 * Eigenes Modul, damit `app.ts` und `src/server/auth/guards.ts` dieselben
 * Verträge nutzen können, ohne zyklisch aufeinander zu importieren.
 */

/** Eine per-Request gebaute better-auth-Instanz (memory ODER D1 — gleiches Interface). */
export type AuthInstance = ReturnType<typeof betterAuth>;

/**
 * Injizierbare Abhängigkeiten der API-App (Aufgabe 1).
 *
 * - `resolveTenant`: Host → Tenant oder `null` (= unbekannte Instanz;
 *   die App antwortet dann 404 fail-closed, KEIN Demo-Fallback).
 * - `createAuthForTenant`: baut die better-auth-Instanz für GENAU diesen
 *   Tenant/Request. Wird pro Request höchstens EINMAL aufgerufen (memoisiert
 *   über die `getAuth`-Context-Variable) und von Auth-Mount, Default-Deny
 *   und Guards GETEILT — kein Doppelbau.
 * - `getBrandingDeps`: Branding-Persistenz (D1-Repo + R2-Bucket) der
 *   Request-Runtime. `null` = Bindings fehlen → die Routen antworten 503
 *   fail-closed. Tests injizieren Map-basierte Fakes — KEIN globaler Zustand.
 * - `getTeamDeps`: Team-Verwaltung (Phase D: Einladungen, Ownership-Transfer,
 *   Audit-Log) der Request-Runtime — gleiche Fail-closed-Semantik wie Branding
 *   (`null` → 503).
 */
export interface ApiDeps {
  resolveTenant(host: string | null | undefined): Promise<Tenant | null>;
  createAuthForTenant(tenant: Tenant): Promise<AuthInstance>;
  getBrandingDeps(): Promise<BrandingDeps | null>;
  getTeamDeps(): Promise<TeamDeps | null>;
  /**
   * Legal-Docs-Persistenz (Design h) der Request-Runtime (D1). `null` = Binding
   * fehlt → die Legal-Routen antworten 503 fail-closed. Tests injizieren einen
   * Map-basierten Fake — kein globaler Zustand.
   */
  getLegalDeps(): Promise<LegalDeps | null>;
  /**
   * Content-Persistenz (Punkt 2, Plan v2 P2) der Request-Runtime (D1). `null` =
   * Binding fehlt → die Content-Admin-Routen antworten 503 fail-closed. Tests
   * injizieren einen (sqlite-/Map-basierten) Fake — kein globaler Zustand.
   */
  getContentDeps(): Promise<ContentDeps | null>;
  /**
   * OAuth-Gateway (Phase E): Krypto-/Nonce-Infrastruktur für den zentralen
   * Provider-Callback auf `auth.hallofhelp.com`. `null`/fehlend ⇒ der
   * Gateway-Host antwortet 503 (Bindings fehlen) — Tenant-Hosts sind unberührt.
   */
  oauthGateway?: OAuthGatewayDeps | null;
  /**
   * Operator-Provisioning (Punkt 4b): Control-Plane-Persistenz + Owner-Setup-
   * Versand. `null`/fehlend ⇒ die Operator-Routen antworten 503 (Bindings
   * fehlen). Optional wie `oauthGateway`, damit reine Fach-Test-Fixtures diese
   * Infrastruktur nicht mitführen müssen. Tests injizieren Map-/DDL-Fakes.
   */
  getOperatorDeps?(): Promise<OperatorDeps | null>;
  /**
   * Turnstile-Prüfung der Tenant-Erstellung (Infra-Plan Schritt 2). Optional
   * NUR für Fixture-Ergonomie — die Operator-Create-Route behandelt `fehlend`
   * als „unavailable" (503, fail-closed), NIE als Bypass. Runtime-Semantik
   * (Secret×Umgebung): security/turnstile.ts. Tests injizieren Fakes.
   */
  verifyTurnstile?: TurnstileVerify;
  /**
   * Metering/Billing (Infra-Plan Schritt 3): usage_events/tenant_usage/
   * tenant_plan auf D1. `null`/fehlend ⇒ Event-Ingestion wird No-op (Analytics
   * darf fail-open sein — es hängt kein Privileg daran) und das Freeze-Gate
   * greift nicht (die Fach-Router antworten ohne D1 ohnehin 503).
   */
  getBillingDeps?(): Promise<BillingDeps | null>;
  /**
   * Custom-Domain-Flow (Infra-Plan Schritt 5): tenant_domain-Persistenz +
   * DoH-TXT-Check + SaaS-Provisioner. `null`/fehlend ⇒ /admin/domain antwortet
   * 503 fail-closed. Tests injizieren Fakes.
   */
  getDomainDeps?(): Promise<DomainDeps | null>;
  /**
   * Such-/RAG-Index (Infra-Plan Schritt 6): hält Vectorize dem Content-
   * Lifecycle hinterher. `null`/fehlend ⇒ Content-Ops laufen OHNE Indexierung
   * weiter (Indexierung ist Best-Effort, nie ein Publish-Blocker; Nachziehen
   * via POST /admin/articles/reindex). Tests injizieren Recorder-Fakes.
   */
  getContentIndexer?(): Promise<ContentIndexer | null>;
  /**
   * Dynamischer KI-Artikel (RAG-Kern): komplette Frage-Pipeline (Embedding →
   * Vectorize → Grounding → Generierung → Metering). `null`/fehlend ⇒
   * POST /ask antwortet 503 (Bindings fehlen). Tests injizieren Fakes.
   */
  getAskDeps?(): Promise<AskRuntime | null>;
}

/** Pro Request aufgelöste Frage-Pipeline (Impl: runtime-deps auf rag/ask.ts). */
export interface AskRuntime {
  answer(input: AskInput): Promise<AskOutcome>;
}

/**
 * Index-Synchronisation des Content-Lifecycles (Infra-Plan Schritt 6).
 * `onContentChange` liest den AKTUELLEN Artikel-Status selbst: published →
 * (re)indexieren, sonst → aus dem Index entfernen — damit ist der Aufruf für
 * publish/unpublish/update/delete identisch und nie falsch herum.
 */
export interface ContentIndexer {
  onContentChange(tenantId: string, articleId: string): Promise<void>;
  rebuildTenant(
    tenantId: string,
  ): Promise<{ articles: number; chunks: number; embedded: number }>;
}

/** Pro Request aufgelöste Custom-Domain-Infrastruktur (Infra-Plan Schritt 5). */
export interface DomainDeps {
  repo: DomainRepository;
  checkTxt: TxtChecker;
  provision: CustomHostnameProvisioner;
}

/**
 * Pro Request aufgelöste Operator-Provisioning-Infrastruktur (Punkt 4b).
 * `sendOwnerSetup` folgt der resend.ts-Semantik: es versendet den Set-Passwort-/
 * Onboarding-Link an das frisch angelegte Owner-Konto auf `<slug>.hallofhelp.com`
 * über den bestehenden Reset-Mechanismus. `devLink` ist NUR ohne Mail-Key und
 * außerhalb Produktion gesetzt (analog `devAcceptUrl` bei Einladungen).
 */
export interface OperatorDeps {
  repo: OperatorRepository;
  sendOwnerSetup(input: { tenant: OperatorTenant; ownerEmail: string }): Promise<OwnerSetupResult>;
}

/**
 * Pro Request aufgelöste Team-Verwaltungs-Infrastruktur (Phase D).
 * `sendInvitationEmail` folgt der resend.ts-Semantik: `true` = wirklich
 * versendet, `false` = No-op ohne konfigurierten Key (dev), throw = echter
 * Zustellfehler.
 */
export interface TeamDeps {
  invitations: InvitationRepository;
  users: TeamUserRepository;
  audit: AuditRepository;
  sendInvitationEmail(data: InvitationEmailData): Promise<boolean>;
}

/**
 * Hono-Environment der API-App.
 * `getAuth` ist ein memoisierter Lazy-Getter: öffentliche Routen ohne
 * Auth-Bedarf (z. B. /tenant) bezahlen den better-auth-Aufbau nicht.
 */
export type ApiEnv = {
  Variables: {
    tenant: Tenant;
    getAuth: () => Promise<AuthInstance>;
  };
};

/**
 * Session-/User-Auszug, wie ihn die Guards benötigen. `auth.api.getSession`
 * ist über `ReturnType<typeof betterAuth>` nur mit den Basis-Feldern typisiert;
 * die per additionalFields deklarierten Felder (tenantId, mfaVerified, role)
 * sind zur Laufzeit vorhanden und werden über diese Interfaces gelesen.
 * `twoFactorEnabled` kommt erst mit dem two-factor-Plugin (Phase C) —
 * bis dahin ist es `undefined` und die MFA-Gates greifen fail-closed.
 */
export interface GuardSessionData {
  session: {
    tenantId?: string | null;
    mfaVerified?: boolean | null;
    /** Unix-Epoche (Sekunden) des letzten Zweitfaktor-Verifys (Step-up, M-5). */
    mfaVerifiedAt?: number | null;
  };
  user: { role?: string | null; twoFactorEnabled?: boolean | null };
}
