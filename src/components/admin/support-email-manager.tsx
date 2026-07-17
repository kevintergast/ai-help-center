"use client";

import { useState, type FormEvent } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Support-E-Mail der Instanz (Migration 0014) — ECHTE Persistenz statt des
 * früheren toten Eingabefelds (der Bug „Speichern funktioniert nicht"):
 * PUT /api/v1/admin/settings/support, admin-Gate. Leeres Feld = Adresse
 * entfernen (Tickets landen dann nur in der Admin-Inbox). Ziel-Adresse der
 * Support-Ticket-Mails („Etwas stimmt nicht?"-Flow).
 */
export function SupportEmailManager({
  locale,
  initialEmail,
}: {
  locale: Locale;
  initialEmail: string | null;
}) {
  const t = getT(locale);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "invalid" | "error">("idle");

  async function save(e: FormEvent) {
    e.preventDefault();
    setState("saving");
    try {
      const res = await fetch("/api/v1/admin/settings/support", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() === "" ? null : email.trim() }),
      });
      if (res.ok) {
        const data = (await res.json()) as { email: string | null };
        setEmail(data.email ?? "");
        setState("saved");
        return;
      }
      setState(res.status === 400 ? "invalid" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3" noValidate>
      <Input
        label={t("admin.settings.supportEmail")}
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setState("idle");
        }}
        placeholder={t("admin.settings.supportEmailPlaceholder")}
        className="max-w-md"
      />
      <p className="-mt-1 text-xs text-ink-muted">{t("admin.settings.supportEmailHint")}</p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={state === "saving"}>
          {state === "saving" ? t("admin.settings.supportSaving") : t("admin.settings.supportSave")}
        </Button>
        <span aria-live="polite" className="text-xs">
          {state === "saved" ? (
            <span className="text-ok">
              {email ? t("admin.settings.supportSaved") : t("admin.settings.supportCleared")}
            </span>
          ) : state === "invalid" ? (
            <span className="text-crit">{t("admin.settings.supportInvalid")}</span>
          ) : state === "error" ? (
            <span className="text-crit">{t("admin.settings.seo.error")}</span>
          ) : null}
        </span>
      </div>
    </form>
  );
}
