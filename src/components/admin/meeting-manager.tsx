"use client";

import { useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import {
  MAX_MEETING_LINKS,
  MEETING_PLACEMENTS,
  parseMeetingInput,
  type MeetingConfig,
  type MeetingLink,
  type MeetingPlacement,
} from "@/lib/content/meeting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { IconButton } from "@/components/ui/icon-button";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";

/**
 * BUCHUNGSLINKS pflegen (0048).
 *
 * MEHRERE Kalender, EINE Stelle: Ein allgemeines Erstgespräch und daneben
 * spezielle Termine („Telefonanlage einrichten"). Die vier automatischen
 * Platzierungen zeigen immer denselben — die speziellen erreicht man gezielt
 * über den Support-Baustein im Artikel.
 *
 * Die KENNUNG ist sprechend und vom Betreiber vergeben (`telefonanlage`), weil
 * sie im Baustein und im MCP-Aufruf auftaucht. Eine Zufallskennung wäre dort
 * eine Rätselaufgabe.
 */

const PLACEMENT_LABELS: Record<MeetingPlacement, MessageKey> = {
  article: "admin.meeting.placement.article",
  noHelp: "admin.meeting.placement.noHelp",
  contact: "admin.meeting.placement.contact",
  home: "admin.meeting.placement.home",
};

const ERROR_KEYS: Record<string, MessageKey> = {
  links_required: "admin.meeting.error.links_required",
  too_many_links: "admin.meeting.error.too_many",
  invalid_id: "admin.meeting.error.invalid_id",
  duplicate_id: "admin.meeting.error.duplicate_id",
  invalid_url: "admin.meeting.error.invalid_url",
  label_required: "admin.meeting.error.label_required",
  title_required: "admin.meeting.error.title_required",
  label_too_long: "admin.meeting.error.too_long",
  title_too_long: "admin.meeting.error.too_long",
  description_too_long: "admin.meeting.error.too_long",
};

const blankLink = (n: number): MeetingLink => ({
  id: n === 1 ? "beratung" : `termin-${n}`,
  title: "",
  label: "",
  description: "",
  url: "",
});

export function MeetingManager({
  locale,
  initial,
}: {
  locale: Locale;
  initial: MeetingConfig | null;
}) {
  const t = getT(locale);
  const [links, setLinks] = useState<MeetingLink[]>(initial?.links ?? [blankLink(1)]);
  const [placements, setPlacements] = useState(
    initial?.placements ?? { article: false, noHelp: false, contact: false, home: false },
  );
  const [placementLinkId, setPlacementLinkId] = useState(initial?.placementLinkId ?? "");
  const [active, setActive] = useState(initial !== null);
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  function patchLink(index: number, change: Partial<MeetingLink>) {
    setLinks((ls) => ls.map((l, i) => (i === index ? { ...l, ...change } : l)));
    setState("idle");
    setErrorKey(null);
  }

  async function save() {
    const parsed = parseMeetingInput({ links, placements, placementLinkId });
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
      setPlacementLinkId(parsed.config.placementLinkId);
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
      setLinks([blankLink(1)]);
      setPlacements({ article: false, noHelp: false, contact: false, home: false });
      setActive(false);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const noPlacement = active && !Object.values(placements).some(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-ink-muted">{t("admin.meeting.hint")}</p>

      <ul className="flex flex-col gap-4">
        {links.map((link, i) => (
          <li key={i} className="flex flex-col gap-3 rounded-card border border-hairline p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Input
                label={t("admin.meeting.id")}
                value={link.id}
                onChange={(e) => patchLink(i, { id: e.target.value })}
                placeholder="telefonanlage"
                className="min-w-[10rem] flex-1"
              />
              <Input
                label={t("admin.meeting.title")}
                value={link.title}
                onChange={(e) => patchLink(i, { title: e.target.value })}
                placeholder={t("admin.meeting.titlePlaceholder")}
                className="min-w-[12rem] flex-[2]"
              />
              {links.length > 1 ? (
                <IconButton
                  aria-label={t("admin.meeting.removeLink")}
                  onClick={() => {
                    setLinks((ls) => ls.filter((_, x) => x !== i));
                    setState("idle");
                  }}
                >
                  <CloseIcon width={16} height={16} />
                </IconButton>
              ) : null}
            </div>
            <Input
              label={t("admin.meeting.url")}
              type="url"
              value={link.url}
              onChange={(e) => patchLink(i, { url: e.target.value })}
              placeholder={t("admin.meeting.urlPlaceholder")}
            />
            <div className="flex flex-wrap gap-3">
              <Input
                label={t("admin.meeting.label")}
                value={link.label}
                onChange={(e) => patchLink(i, { label: e.target.value })}
                placeholder={t("admin.meeting.labelPlaceholder")}
                className="min-w-[11rem] flex-1"
              />
              <Input
                label={t("admin.meeting.description")}
                value={link.description}
                onChange={(e) => patchLink(i, { description: e.target.value })}
                placeholder={t("admin.meeting.descriptionPlaceholder")}
                className="min-w-[13rem] flex-[2]"
              />
            </div>
          </li>
        ))}
      </ul>

      <div>
        <Button
          variant="ghost"
          onClick={() => {
            setLinks((ls) => [...ls, blankLink(ls.length + 1)]);
            setState("idle");
          }}
          disabled={links.length >= MAX_MEETING_LINKS}
        >
          <PlusIcon width={16} height={16} />
          {t("admin.meeting.addLink")}
        </Button>
      </div>

      <div className="border-t border-hairline pt-4">
        <h3 className="text-sm font-medium">{t("admin.meeting.placementsHeading")}</h3>
        <p className="mt-1 text-xs text-ink-muted">{t("admin.meeting.placementsHint")}</p>

        {/* Welcher Kalender an den automatischen Stellen steht — erst ab zwei
            eine Frage; bei einem einzigen wäre die Auswahl eine Attrappe. */}
        {links.length > 1 ? (
          <div className="mt-3 max-w-sm">
            <span className="mb-1 block text-xs text-ink-muted">
              {t("admin.meeting.placementLink")}
            </span>
            <Select
              options={links.map((l) => ({ value: l.id, label: l.title || l.id }))}
              value={placementLinkId || links[0].id}
              onValueChange={(v) => {
                setPlacementLinkId(v);
                setState("idle");
              }}
              aria-label={t("admin.meeting.placementLink")}
            />
          </div>
        ) : null}

        <div className="mt-3 flex flex-col gap-2">
          {MEETING_PLACEMENTS.map((key) => (
            <Switch
              key={key}
              checked={placements[key]}
              onCheckedChange={(v) => {
                setPlacements((p) => ({ ...p, [key]: v }));
                setState("idle");
              }}
              label={t(PLACEMENT_LABELS[key])}
            />
          ))}
        </div>
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
