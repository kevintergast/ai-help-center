"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import type { MessageKey } from "@/i18n/messages/de";
import {
  ALL_SCOPES,
  DEFAULT_SCOPES,
  includesPii,
  isBroadAccess,
  riskLevel,
  scopeDef,
  scopesNeedingAcknowledgement,
  SCOPE_TIERS,
  type ApiScope,
  type RiskLevel,
  type ScopeTier,
} from "@/server/apikeys/scopes";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/**
 * ZUGRIFFS-SCHLÜSSEL — Verwaltung mit sichtbaren Konsequenzen.
 *
 * Anforderung (Kevin, 2026-08-22): „im API-Key muss man sehen können, was man
 * erlaubt … es soll aktiv stark gewarnt werden, wenn der Key viel erlaubt."
 *
 * Umsetzung: keine nackte Scope-Liste. Jede Berechtigung steht als SATZ da
 * („Kann Artikel veröffentlichen — sofort für alle Besucher sichtbar"),
 * gruppiert nach Eskalationsstufe, mit einem Risiko-Badge über der Auswahl und
 * Warnboxen, die mit der Auswahl schärfer werden. Rote Rechte brauchen eine
 * eigene Bestätigung je Recht — und zwar nicht nur hier: der Server verlangt
 * dieselbe Bestätigung im Request (api/api-keys.ts). Eine Checkbox allein wäre
 * keine Kontrolle.
 */

export interface ApiKeyView {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiScope[];
  risk: RiskLevel;
  broadAccess: boolean;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  status: "active" | "revoked" | "expired";
}

const TIER_TONE: Record<ScopeTier, "ok" | "brand" | "warn" | "crit"> = {
  read: "ok",
  write: "brand",
  public: "warn",
  destructive: "crit",
};

const RISK_TONE: Record<RiskLevel, "ok" | "brand" | "warn" | "crit"> = {
  low: "ok",
  medium: "brand",
  high: "warn",
  critical: "crit",
};

/**
 * Schlüssel-Ableitung OHNE `as MessageKey`: Der Rückgabetyp ist annotiert, der
 * Ausdruck ist ein Template-Literal-Typ über ALLE Scopes/Stufen — TypeScript
 * prüft damit, dass zu jedem Katalog-Eintrag auch ein Übersetzungstext
 * existiert. Genau das hatte der frühere Cast unterdrückt: `updates:write` war
 * im Scope-Katalog, aber ohne Label, und die Checkbox blieb leer.
 */
const scopeLabelKey = (s: ApiScope): MessageKey => `admin.apiKeys.scope.${s}.label`;
const scopeHintKey = (s: ApiScope): MessageKey => `admin.apiKeys.scope.${s}.hint`;
const tierTitleKey = (tier: ScopeTier): MessageKey => `admin.apiKeys.tier.${tier}`;
const riskLabelKey = (risk: RiskLevel): MessageKey => `admin.apiKeys.risk.${risk}`;

/**
 * Bestätigungstexte gibt es NUR für rote Scopes — ein Template über alle
 * Scopes würde hier Texte verlangen, die es zu Recht nicht gibt. `satisfies`
 * hält trotzdem beides fest: gültige Scope-Ids und gültige Message-Keys.
 */
const ACK_KEYS = {
  "articles:delete": "admin.apiKeys.ack.articles:delete",
  "support:delete": "admin.apiKeys.ack.support:delete",
} as const satisfies Partial<Record<ApiScope, MessageKey>>;

/** Tage bis zum Ablauf — Auswahl bewusst kurz gehalten (Rotation als Hygiene). */
const EXPIRY_CHOICES = [30, 90, 365] as const;

export function ApiKeysManager({ locale, mcpUrl }: { locale: Locale; mcpUrl: string }) {
  const t = getT(locale);
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<ApiScope[]>([...DEFAULT_SCOPES]);
  const [acknowledged, setAcknowledged] = useState<ApiScope[]>([]);
  const [expiresInDays, setExpiresInDays] = useState<number>(90);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ token: string; scopes: ApiScope[] } | null>(null);

  // Bestand nachladen (Muster inbox-view: Seite rendert, Liste kommt per API).
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v1/admin/api-keys");
        if (!res.ok) return;
        const body = (await res.json()) as { keys: ApiKeyView[] };
        setKeys(body.keys);
      } catch {
        // Stiller Fehlschlag: die Liste bleibt leer, das Anlegen funktioniert.
      }
    })();
  }, []);

  const risk = useMemo(() => riskLevel(selected), [selected]);
  const needsAck = useMemo(() => scopesNeedingAcknowledgement(selected), [selected]);
  const missingAck = needsAck.filter((s) => !acknowledged.includes(s));
  const broad = isBroadAccess(selected);
  const pii = includesPii(selected);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );
  const formatDate = (sec: number) => dateFmt.format(new Date(sec * 1000));

  function toggleScope(scope: ApiScope, on: boolean) {
    setSelected((prev) => (on ? [...prev, scope] : prev.filter((s) => s !== scope)));
    if (!on) setAcknowledged((prev) => prev.filter((s) => s !== scope));
  }

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          scopes: selected,
          acknowledgedScopes: acknowledged,
          expiresInDays,
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(String(body.error ?? "error"));
        return;
      }
      setFresh({ token: body.token as string, scopes: selected });
      setKeys((prev) => [
        {
          id: body.id as string,
          name,
          keyPrefix: body.keyPrefix as string,
          scopes: selected,
          risk,
          broadAccess: broad,
          createdAt: Math.floor(Date.now() / 1000),
          expiresAt: body.expiresAt as number,
          lastUsedAt: null,
          status: "active",
        },
        ...prev,
      ]);
      setName("");
      setSelected([...DEFAULT_SCOPES]);
      setAcknowledged([]);
    } catch {
      setError("error");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/v1/admin/api-keys/${id}`, { method: "DELETE" });
    if (res.ok) {
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, status: "revoked" } : k)));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Frisch erzeugter Schlüssel: einmalige Anzeige ─────────────── */}
      {fresh ? (
        <section className="rounded-card border border-ok-bd bg-ok-bg p-5">
          <h3 className="mb-1 font-semibold text-ink">{t("admin.apiKeys.created.title")}</h3>
          <p className="mb-3 text-sm text-ink-muted">{t("admin.apiKeys.created.onceOnly")}</p>
          <code className="block break-all rounded-card border border-hairline bg-surface p-3 font-mono text-sm">
            {fresh.token}
          </code>
          <p className="mt-3 text-sm font-medium text-ink">{t("admin.apiKeys.created.allows")}</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
            {fresh.scopes.map((s) => (
              <li key={s}>{t(scopeLabelKey(s))}</li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigator.clipboard.writeText(fresh.token)}
            >
              {t("admin.apiKeys.created.copy")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFresh(null)}>
              {t("admin.apiKeys.created.done")}
            </Button>
          </div>
        </section>
      ) : null}

      {/* ── Neuer Schlüssel ───────────────────────────────────────────── */}
      <section className="rounded-card border border-hairline bg-surface p-6">
        <h3 className="mb-1 font-semibold">{t("admin.apiKeys.new.title")}</h3>
        <p className="mb-4 text-sm text-ink-muted">{t("admin.apiKeys.new.subtitle")}</p>

        <div className="mb-5 max-w-sm">
          <Input
            label={t("admin.apiKeys.new.nameLabel")}
            value={name}
            placeholder={t("admin.apiKeys.new.namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Berechtigungen, gruppiert nach Eskalationsstufe. */}
        <div className="flex flex-col gap-5">
          {SCOPE_TIERS.map((tier) => {
            const scopes = ALL_SCOPES.filter((s) => scopeDef(s).tier === tier);
            return (
              <fieldset key={tier} className="rounded-card border border-hairline p-4">
                <legend className="px-1">
                  <Badge tone={TIER_TONE[tier]} dot>
                    {t(tierTitleKey(tier))}
                  </Badge>
                </legend>
                <div className="flex flex-col gap-3 pt-2">
                  {scopes.map((scope) => (
                    <div key={scope} className="flex flex-col gap-1">
                      <Switch
                        checked={selected.includes(scope)}
                        onCheckedChange={(on) => toggleScope(scope, on)}
                        label={t(scopeLabelKey(scope))}
                      />
                      <p className="pl-12 text-xs text-ink-muted">{t(scopeHintKey(scope))}</p>

                      {/* Rotes Recht: eigene, ausdrückliche Bestätigung. */}
                      {tier === "destructive" && selected.includes(scope) ? (
                        <label className="ml-12 mt-1 flex items-start gap-2 rounded-card border border-crit-bd bg-crit-bg p-2.5 text-xs text-crit">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={acknowledged.includes(scope)}
                            onChange={(e) =>
                              setAcknowledged((prev) =>
                                e.target.checked
                                  ? [...prev, scope]
                                  : prev.filter((s) => s !== scope),
                              )
                            }
                          />
                          <span>
                            {scope in ACK_KEYS ? t(ACK_KEYS[scope as keyof typeof ACK_KEYS]) : null}
                          </span>
                        </label>
                      ) : null}
                    </div>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>

        {/* ── Eskalierende Warnungen ──────────────────────────────────── */}
        <div className="mt-5 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">{t("admin.apiKeys.risk.label")}</span>
            <Badge tone={RISK_TONE[risk]} dot>
              {t(riskLabelKey(risk))}
            </Badge>
          </div>

          {risk === "low" || risk === "medium" ? (
            <p className="text-sm text-ink-muted">{t("admin.apiKeys.warn.draftsOnly")}</p>
          ) : null}

          {selected.includes("articles:publish") || selected.includes("settings:write") ? (
            <Banner
              tone="warn"
              title={t("admin.apiKeys.warn.public.title")}
              description={t("admin.apiKeys.warn.public.text")}
            />
          ) : null}

          {pii ? (
            <Banner
              tone="warn"
              title={t("admin.apiKeys.warn.pii.title")}
              description={t("admin.apiKeys.warn.pii.text")}
            />
          ) : null}

          {needsAck.length > 0 ? (
            <Banner
              tone="crit"
              title={t("admin.apiKeys.warn.destructive.title")}
              description={t("admin.apiKeys.warn.destructive.text")}
            />
          ) : null}

          {broad ? (
            <Banner
              tone="crit"
              title={t("admin.apiKeys.warn.broad.title")}
              description={t("admin.apiKeys.warn.broad.text")}
            />
          ) : null}
        </div>

        {/* Ablauf — unbefristete Schlüssel gibt es bewusst nicht. */}
        <div className="mt-5">
          <span className="text-sm text-ink-muted">{t("admin.apiKeys.new.expiryLabel")}</span>
          <div className="mt-2 flex gap-2">
            {EXPIRY_CHOICES.map((days) => (
              <Button
                key={days}
                variant={expiresInDays === days ? "primary" : "ghost"}
                size="sm"
                onClick={() => setExpiresInDays(days)}
              >
                {t(`admin.apiKeys.new.expiry.${days}` as MessageKey)}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button
            onClick={() => void create()}
            disabled={
              creating || name.trim().length === 0 || selected.length === 0 || missingAck.length > 0
            }
          >
            {creating ? t("admin.apiKeys.new.creating") : t("admin.apiKeys.new.submit")}
          </Button>
          {missingAck.length > 0 ? (
            <span className="text-xs text-crit">{t("admin.apiKeys.new.ackMissing")}</span>
          ) : null}
          {error ? <span className="text-xs text-crit">{t("admin.apiKeys.new.error")}</span> : null}
        </div>
      </section>

      {/* ── Verbindungs-Anleitung ─────────────────────────────────────── */}
      <section className="rounded-card border border-hairline bg-surface p-6">
        <h3 className="mb-1 font-semibold">{t("admin.apiKeys.connect.title")}</h3>
        <p className="mb-3 text-sm text-ink-muted">{t("admin.apiKeys.connect.subtitle")}</p>
        <code className="block break-all rounded-card border border-hairline bg-canvas p-3 font-mono text-xs">
          {mcpUrl}
        </code>
        <p className="mt-3 text-xs text-ink-muted">{t("admin.apiKeys.connect.claudeCode")}</p>
        <code className="mt-1 block break-all rounded-card border border-hairline bg-canvas p-3 font-mono text-xs">
          {`claude mcp add --transport http hallofhelp ${mcpUrl} --header "Authorization: Bearer <KEY>"`}
        </code>
      </section>

      {/* ── Bestehende Schlüssel ──────────────────────────────────────── */}
      <section className="rounded-card border border-hairline bg-surface p-6">
        <h3 className="mb-4 font-semibold">{t("admin.apiKeys.list.title")}</h3>
        {keys.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("admin.apiKeys.list.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-hairline p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="font-medium">{key.name}</strong>
                    <code className="font-mono text-xs text-ink-muted">{key.keyPrefix}…</code>
                    <Badge tone={RISK_TONE[key.risk]} dot>
                      {t(riskLabelKey(key.risk))}
                    </Badge>
                    {key.status !== "active" ? (
                      <Badge tone="neutral">
                        {t(`admin.apiKeys.list.status.${key.status}` as MessageKey)}
                      </Badge>
                    ) : null}
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
                    {key.scopes.map((s) => (
                      <li key={s}>• {t(scopeLabelKey(s))}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-ink-muted">
                    {t("admin.apiKeys.list.expires")} {formatDate(key.expiresAt)} ·{" "}
                    {key.lastUsedAt
                      ? `${t("admin.apiKeys.list.lastUsed")} ${formatDate(key.lastUsedAt)}`
                      : t("admin.apiKeys.list.neverUsed")}
                  </p>
                </div>
                {key.status === "active" ? (
                  <Button variant="ghost" size="sm" onClick={() => void revoke(key.id)}>
                    {t("admin.apiKeys.list.revoke")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
