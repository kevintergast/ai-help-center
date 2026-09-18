"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * Rückfrage vor dem Verlassen mit ungespeicherten Änderungen.
 *
 * DREI WEGE, und die Reihenfolge ist Absicht: „Hierbleiben" steht links und
 * ist der sichere Ausweg; „Verwerfen" steht rechts, weil es der einzige ist,
 * der etwas zerstört. Speichern in der Mitte — der Normalfall.
 *
 * Geht das Speichern schief, wird NICHT navigiert: Sonst wäre der Entwurf
 * genau dann weg, wenn man ihn retten wollte.
 */
export function UnsavedGuardDialog({
  locale,
  href,
  onCancel,
  onSave,
  onDiscard,
}: {
  locale: Locale;
  /** Ziel der abgefangenen Navigation; `null` = Dialog zu. */
  href: string | null;
  onCancel: () => void;
  /** Speichert; `false` = fehlgeschlagen, dann bleiben wir hier. */
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
}) {
  const t = getT(locale);
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  return (
    <Dialog
      open={href !== null}
      onClose={onCancel}
      closeLabel={t("admin.guard.stay")}
      title={t("admin.guard.title")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            {t("admin.guard.stay")}
          </Button>
          <Button
            variant="cream"
            size="sm"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onSave();
              setSaving(false);
              if (!ok) return; // Fehlgeschlagen → hierbleiben, nichts verlieren.
              const target = href;
              onCancel();
              if (target) router.push(target);
            }}
          >
            {saving ? t("admin.guard.saving") : t("admin.guard.saveAndGo")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={saving}
            onClick={() => {
              const target = href;
              onDiscard();
              onCancel();
              if (target) router.push(target);
            }}
          >
            {t("admin.guard.discard")}
          </Button>
        </>
      }
    >
      {t("admin.guard.body")}
    </Dialog>
  );
}
