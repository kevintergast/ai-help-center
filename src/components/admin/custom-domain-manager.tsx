"use client";

import { useCallback, useEffect, useState } from "react";
import { getT } from "@/i18n/t";
import type { MessageKey } from "@/i18n/messages/de";
import type { Locale } from "@/lib/tenant/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote } from "@/components/auth/notes";

/**
 * Custom-Domain-Verwaltung (Infra-Plan Schritt 5) — funktionaler Teil der
 * Settings-Domain-Karte: Domain beanspruchen → TXT-Anleitung → prüfen →
 * verifiziert (bzw. entfernen). Mutationen sind serverseitig OWNER-exklusiv;
 * für andere Rollen zeigen 403-Antworten den Hinweis statt der Aktion.
 */

interface ClaimView {
  domain: string;
  status: "pending" | "verified" | "revoked";
  txtRecordName: string;
  txtRecordValue: string;
}

const ERROR_KEYS: Record<string, MessageKey> = {
  invalid_domain: "admin.domain.error.invalid",
  reserved_domain: "admin.domain.error.reserved",
  domain_taken: "admin.domain.error.taken",
  txt_not_found: "admin.domain.error.txtNotFound",
  txt_mismatch: "admin.domain.error.txtMismatch",
  dns_error: "admin.domain.error.dns",
};

export function CustomDomainManager({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [claim, setClaim] = useState<ClaimView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/domain", { headers: { accept: "application/json" } });
      if (res.ok) {
        const data = (await res.json()) as { claim: ClaimView | null };
        setClaim(data.claim);
      }
    } catch {
      /* Karte bleibt im Leerzustand */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(method: "PUT" | "POST" | "DELETE", path: string, body?: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(path, {
        method,
        headers: {
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (res.status === 403) {
        setError(t("admin.domain.ownerOnly"));
        return null;
      }
      if (!res.ok) {
        const key = ERROR_KEYS[(data?.error as string) ?? ""] ?? "admin.domain.error.generic";
        setError(t(key));
        return null;
      }
      return data;
    } catch {
      setError(t("admin.domain.error.generic"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    const data = await mutate("PUT", "/api/v1/admin/domain", { domain: input });
    if (!data) return;
    setClaim({
      domain: data.domain as string,
      status: "pending",
      txtRecordName: data.txtRecordName as string,
      txtRecordValue: data.txtRecordValue as string,
    });
    setInput("");
  }

  async function verify() {
    const data = await mutate("POST", "/api/v1/admin/domain/verify");
    if (!data) return;
    setClaim((c) => (c ? { ...c, status: "verified" } : c));
    const provisioning = data.provisioning as string;
    setNotice(
      provisioning === "provisioned"
        ? t("admin.domain.provisioningDone")
        : provisioning === "failed"
          ? t("admin.domain.provisioningFailed")
          : t("admin.domain.provisioningSkipped"),
    );
  }

  async function remove() {
    const data = await mutate("DELETE", "/api/v1/admin/domain");
    if (!data) return;
    setClaim(null);
  }

  async function copyValue() {
    if (!claim) return;
    try {
      await navigator.clipboard.writeText(claim.txtRecordValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Clipboard gesperrt — Wert steht sichtbar daneben */
    }
  }

  if (!loaded) return <p className="text-sm text-ink-muted">{t("admin.domain.loading")}</p>;

  if (!claim) {
    return (
      <div className="flex max-w-md flex-col gap-3">
        <Input
          label={t("admin.settings.customDomain")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("admin.domain.placeholder")}
          autoCapitalize="none"
          spellCheck={false}
        />
        <p className="-mt-1 text-xs text-ink-muted">{t("admin.settings.customDomainHint")}</p>
        <ErrorNote>{error || null}</ErrorNote>
        <div>
          <Button size="sm" onClick={connect} disabled={busy || input.trim().length < 4}>
            {t("admin.domain.connect")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-ink">{claim.domain}</span>
        {claim.status === "verified" ? (
          <Badge tone="ok" dot>
            {t("admin.domain.verifiedBadge")}
          </Badge>
        ) : (
          <Badge tone="warn" dot>
            {t("admin.domain.pendingBadge")}
          </Badge>
        )}
      </div>

      {claim.status !== "verified" ? (
        <div className="rounded-card border border-hairline bg-surface-raised p-4">
          <p className="text-sm text-ink">{t("admin.domain.pendingHelp")}</p>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <dt className="w-14 shrink-0 text-ink-muted">{t("admin.domain.recordType")}</dt>
              <dd className="font-mono">{"TXT"}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="w-14 shrink-0 text-ink-muted">{t("admin.domain.recordName")}</dt>
              <dd className="break-all font-mono">{claim.txtRecordName}</dd>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <dt className="w-14 shrink-0 text-ink-muted">{t("admin.domain.recordValue")}</dt>
              <dd className="break-all font-mono">{claim.txtRecordValue}</dd>
              <Button variant="ghost" size="sm" onClick={copyValue}>
                {copied ? t("admin.domain.copied") : t("admin.domain.copy")}
              </Button>
            </div>
          </dl>
        </div>
      ) : null}

      {notice ? <p className="text-sm text-ok">{notice}</p> : null}
      <ErrorNote>{error || null}</ErrorNote>

      <div className="flex flex-wrap gap-2">
        {claim.status !== "verified" ? (
          <Button size="sm" onClick={verify} disabled={busy}>
            {t("admin.domain.verifyNow")}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>
          {t("admin.domain.remove")}
        </Button>
      </div>
    </div>
  );
}
