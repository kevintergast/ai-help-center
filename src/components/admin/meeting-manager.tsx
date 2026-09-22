"use client";

import { useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import {
  MEETING_PLACEMENTS,
  parseMeetingInput,
  type MeetingConfig,
  type MeetingPlacement,
} from "@/lib/content/meeting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/**
 * BUCHUNGSLINK pflegen (0048).
 *
 * Adresse, Beschriftung und Überschrift stehen EINMAL — die vier Schalter
 * darunter entscheiden, wo das erscheint. Das ist der Grund, warum der Link
 * nicht als vierter Kontaktweg gespeichert wird: Dort läge die Adresse an
 * einer Stelle und die Schalter für die anderen drei Flächen woanders.
 *
 * Geprüft wird vor dem Senden mit derselben Funktion wie auf dem Server und
 * im MCP-Werkzeug.
 */

const PLACEMENT_LABELS: Record<MeetingPlacement, MessageKey> = {
  article: "admin.meeting.placement.article",
  noHelp: "admin.meeting.placement.noHelp",
  contact: "admin.meeting.placement.contact",
  home: "admin.meeting.placement.home",
};

const ERROR_KEYS: Record<string, MessageKey> = {
  invalid_url: "admin.meeting.error.invalid_url",
  label_required: "admin.meeting.error.label_required",
  label_too_long: "admin.meeting.error.too_long",
  title_required: "admin.meeting.error.title_required",
  title_too_long: "admin.meeting.error.too_long",
  description_too_long: "admin.meeting.error.too_long",
};

const EMPTY = {
  url: "",
  label: "",
  title: "",
  description: "",
  placements: { article: false, noHelp: false, contact: false, home: false },
};

export function MeetingManager({
  locale,
  initial,
}: {
  locale: Locale;
  initial: MeetingConfig | null;
}) {
  const t = getT(locale);
  const [draft, setDraft] = useState<MeetingConfig>(initial ?? EMPTY);
  const [active, setActive] = useState(initial !== null);
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  function patch(change: Partial<MeetingConfig>) {
    setDraft((d) => ({ ...d, ...change }));
    setState("idle");
    setErrorKey(null);
  }

  async function save() {
    const parsed = parseMeetingInput(draft);
    if (!parsed.ok) {
      setErrorKey(ERROR_KEYS[parsed.error] ?? "admin.meeting.error.generic");
      return;
    }
    setState("saving");
    setErrorKey(null);
    try {
      const res = await fetch("/api/v1/admin/settings/meeting", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.config),
      });
      if (!res.ok) throw new Error("save");
      setActive(true);
      setState("done");
    } catch {
      setState("error");
    }
  }

  async function remove() {
    setState("saving");
    try {
      const res = await fetch("/api/v1/admin/settings/meeting", { method: "DELETE" });
      if (!res.ok) throw new Error("remove");
      setDraft(EMPTY);
      setActive(false);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const noPlacement = active && !Object.values(draft.placements).some(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-muted">{t("admin.meeting.hint")}</p>

      <Input
        label={t("admin.meeting.url")}
        type="url"
        value={draft.url}
        onChange={(e) => patch({ url: e.target.value })}
        placeholder={t("admin.meeting.urlPlaceholder")}
        className="max-w-xl"
      />
      <div className="flex flex-wrap gap-3">
        <Input
          label={t("admin.meeting.title")}
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder={t("admin.meeting.titlePlaceholder")}
          className="min-w-[14rem] flex-1"
        />
        <Input
          label={t("admin.meeting.label")}
          value={draft.label}
          onChange={(e) => patch({ label: e.target.value })}
          placeholder={t("admin.meeting.labelPlaceholder")}
          className="min-w-[12rem] flex-1"
        />
      </div>
      <Input
        label={t("admin.meeting.description")}
        value={draft.description}
        onChange={(e) => patch({ description: e.target.value })}
        placeholder={t("admin.meeting.descriptionPlaceholder")}
        className="max-w-xl"
      />

      <div className="border-t border-hairline pt-4">
        <h3 className="text-sm font-medium">{t("admin.meeting.placementsHeading")}</h3>
        <p className="mt-1 text-xs text-ink-muted">{t("admin.meeting.placementsHint")}</p>
        <div className="mt-3 flex flex-col gap-2">
          {MEETING_PLACEMENTS.map((key) => (
            <Switch
              key={key}
              checked={draft.placements[key]}
              onCheckedChange={(v) => patch({ placements: { ...draft.placements, [key]: v } })}
              label={t(PLACEMENT_LABELS[key])}
            />
          ))}
        </div>
        {/* Gespeichert, aber nirgends an: ein stiller Zustand, den man sonst
            erst merkt, wenn sich niemand meldet. */}
        {noPlacement ? (
          <p className="mt-2 text-xs text-warn">{t("admin.meeting.noPlacementWarning")}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={state === "saving"}>
          {t("admin.meeting.save")}
        </Button>
        {active ? (
          <Button variant="ghost" onClick={() => void remove()} disabled={state === "saving"}>
            {t("admin.meeting.remove")}
          </Button>
        ) : null}
        <span aria-live="polite" className="text-xs">
          {errorKey ? (
            <span className="text-crit">{t(errorKey)}</span>
          ) : state === "done" ? (
            <span className="text-ok">{t("admin.meeting.saved")}</span>
          ) : state === "error" ? (
            <span className="text-crit">{t("admin.meeting.error.generic")}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
