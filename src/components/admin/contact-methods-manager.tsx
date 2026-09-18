"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import {
  CONTACT_KINDS,
  MAX_CONTACT_METHODS,
  parseContactMethodInput,
  type ContactKind,
  type ContactMethod,
} from "@/lib/content/contact-methods";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { IconButton } from "@/components/ui/icon-button";
import { useUnsavedGuard } from "@/lib/admin/use-unsaved-guard";
import { UnsavedGuardDialog } from "@/components/admin/unsaved-guard-dialog";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";

/**
 * KONTAKTWEGE pflegen (0037) — Karten der Seite `/contact`.
 *
 * Wie die Einstiegs-Karten: EIN PUT für den ganzen Satz, serverseitig ein
 * Batch. Und wie dort wird VOR dem Senden mit derselben Funktion geprüft, die
 * der Server benutzt — der Fehler steht dann am Feld statt als anonymes „400".
 *
 * Es gibt keinen „Kontaktseite anzeigen"-Schalter: Seite und Navigations-
 * Eintrag erscheinen genau dann, wenn hier mindestens ein Weg steht. Ein
 * zweiter Schalter wäre eine zweite Wahrheit — „eingeschaltet, aber leer"
 * ergäbe eine Seite, die nichts anbietet.
 */

type Draft = Omit<ContactMethod, "id"> & { key: string };

const KIND_LABELS: Record<ContactKind, MessageKey> = {
  email: "admin.contact.kind.email",
  phone: "admin.contact.kind.phone",
  form: "admin.contact.kind.form",
};

const ERROR_KEYS: Record<string, MessageKey> = {
  title_required: "admin.contact.error.title_required",
  title_too_long: "admin.contact.error.title_too_long",
  description_too_long: "admin.contact.error.description_too_long",
  value_required: "admin.contact.error.value_required",
  invalid_email: "admin.contact.error.invalid_email",
  invalid_phone: "admin.contact.error.invalid_phone",
  invalid_kind: "admin.contact.error.generic",
};

let seq = 0;
const nextKey = () => `cm_draft_${(seq += 1)}`;

export function ContactMethodsManager({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [state, setState] = useState<"loading" | "idle" | "saving" | "done" | "error">("loading");
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  /**
   * Zuletzt GESPEICHERTER Stand. Ohne ihn wüsste die Seite nicht, ob etwas
   * offen ist — und „Verwerfen" hätte nichts, wohin es zurückkehren könnte.
   */
  const [pristine, setPristine] = useState<string>("[]");
  const dirty = JSON.stringify(drafts.map(({ key: _k, ...rest }) => rest)) !== pristine;
  const guard = useUnsavedGuard(dirty);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/v1/admin/contact-methods");
        if (!res.ok) throw new Error("load");
        const data = (await res.json()) as { methods: ContactMethod[] };
        if (!alive) return;
        const loaded = data.methods.map((m) => ({ ...m, key: nextKey() }));
        setDrafts(loaded);
        setPristine(JSON.stringify(loaded.map(({ key: _k, ...rest }) => rest)));
        setState("idle");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function patch(key: string, change: Partial<Draft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...change } : d)));
    setState("idle");
    setErrorKey(null);
  }

  async function save(): Promise<boolean> {
    const methods: Omit<ContactMethod, "id">[] = [];
    for (const d of drafts) {
      const res = parseContactMethodInput(d);
      if (!res.ok) {
        setErrorKey(ERROR_KEYS[res.error] ?? "admin.contact.error.generic");
        setState("idle");
        return false;
      }
      methods.push(res.method);
    }

    setState("saving");
    setErrorKey(null);
    try {
      const res = await fetch("/api/v1/admin/contact-methods", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ methods }),
      });
      if (!res.ok) throw new Error("save");
      const fresh = (await res.json()) as { methods: ContactMethod[] };
      const next = fresh.methods.map((m) => ({ ...m, key: nextKey() }));
      setDrafts(next);
      setPristine(JSON.stringify(next.map(({ key: _k, ...rest }) => rest)));
      setState("done");
      return true;
    } catch {
      setState("error");
      return false;
    }
  }

  if (state === "loading") return <p className="text-sm text-ink-muted">…</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-muted">
        {t("admin.contact.hint", { max: MAX_CONTACT_METHODS })}
      </p>

      {drafts.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("admin.contact.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {drafts.map((d) => (
            <li
              key={d.key}
              className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-4"
            >
              {/* Umbruch erlaubt und Ausrichtung an der Unterkante: Die Zeile
                  hielt vorher mit fester Auswahlbreite + dehnbarem Feld + Knopf
                  auf schmalen Schirmen nicht mehr zusammen, und der Knopf saß
                  per festem Rand auf Position — sobald eine Beschriftung
                  umbrach, stand er daneben. */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-full min-w-[11rem] sm:w-44 sm:flex-none">
                  <span className="mb-1 block text-xs text-ink-muted">
                    {t("admin.contact.kind")}
                  </span>
                  <Select
                    options={CONTACT_KINDS.map((k) => ({ value: k, label: t(KIND_LABELS[k]) }))}
                    value={d.kind}
                    // Artwechsel macht den alten Wert bedeutungslos — eine
                    // Rufnummer im Adressfeld wäre eine stille Fehlerquelle.
                    onValueChange={(v) => patch(d.key, { kind: v as ContactKind, value: "" })}
                    aria-label={t("admin.contact.kind")}
                  />
                </div>
                <Input
                  label={t("admin.contact.methodTitle")}
                  value={d.title}
                  onChange={(e) => patch(d.key, { title: e.target.value })}
                  placeholder={t("admin.contact.methodTitlePlaceholder")}
                  className="min-w-[12rem] flex-1"
                />
                <IconButton
                  aria-label={t("admin.contact.delete")}
                  onClick={() => {
                    setDrafts((ds) => ds.filter((x) => x.key !== d.key));
                    setState("idle");
                  }}
                  className="ml-auto"
                >
                  <CloseIcon width={16} height={16} />
                </IconButton>
              </div>

              <Input
                label={t("admin.contact.description")}
                value={d.description}
                onChange={(e) => patch(d.key, { description: e.target.value })}
                placeholder={t("admin.contact.descriptionPlaceholder")}
              />

              {d.kind === "form" ? (
                <p className="text-xs text-ink-muted">{t("admin.contact.formNote")}</p>
              ) : (
                <Input
                  label={
                    d.kind === "email" ? t("admin.contact.email") : t("admin.contact.phone")
                  }
                  type={d.kind === "email" ? "email" : "tel"}
                  value={d.value}
                  onChange={(e) => patch(d.key, { value: e.target.value })}
                  className="max-w-md"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          onClick={() => {
            setDrafts((ds) => [
              ...ds,
              { key: nextKey(), kind: "email", title: "", description: "", value: "" },
            ]);
            setState("idle");
          }}
          disabled={drafts.length >= MAX_CONTACT_METHODS}
        >
          <PlusIcon width={16} height={16} />
          {t("admin.contact.add")}
        </Button>
        <Button onClick={() => void save()} disabled={state === "saving"}>
          {t("admin.contact.save")}
        </Button>
        <span aria-live="polite" className="text-xs">
          {errorKey ? (
            <span className="text-crit">{t(errorKey)}</span>
          ) : state === "done" ? (
            <span className="text-ok">{t("admin.contact.saved")}</span>
          ) : state === "error" ? (
            <span className="text-crit">{t("admin.contact.error.generic")}</span>
          ) : drafts.length >= MAX_CONTACT_METHODS ? (
            <span className="text-ink-muted">
              {t("admin.contact.full", { max: MAX_CONTACT_METHODS })}
            </span>
          ) : null}
        </span>
      </div>

      {/* Rückfrage, bevor ungespeicherte Änderungen verloren gehen. */}
      <UnsavedGuardDialog
        locale={locale}
        href={guard.pendingHref}
        onCancel={guard.cancel}
        onSave={save}
        onDiscard={() => setDrafts(JSON.parse(pristine).map((d: object) => ({ ...d, key: nextKey() })))}
      />
    </div>
  );
}
