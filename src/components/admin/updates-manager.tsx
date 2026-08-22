"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import { CHANGELOG_LEVELS, ROADMAP_STATUS } from "@/server/content/updates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CloseIcon, PencilIcon } from "@/components/ui/icons";

/**
 * PFLEGE von Changelog + Roadmap (0030). Vorher gab es dafür KEINE Oberfläche —
 * beide Inhalte kamen nur aus dem Seed-Skript, Kunden konnten sie nicht ändern.
 *
 * Changelog-Einträge sind SOFORT öffentlich (kein Entwurf, s. api/updates.ts) —
 * das steht auch als Hinweis über der Liste, damit niemand hier „mal etwas
 * vorbereitet". Die Versionsnummer ist freier Text: „2.4.0", „R25-08" und
 * „Frühjahr 2026" sind gleichermaßen gültig.
 */

interface ChangelogEntry {
  id: string;
  title: string;
  description: string;
  version: string | null;
  level: "major" | "minor" | "patch" | null;
  publishedAt: number;
}

interface RoadmapItem {
  id: string;
  title: string;
  status: "planned" | "in_progress" | "shipped";
  sort: number;
}

const LEVEL_KEYS: Record<"major" | "minor" | "patch", MessageKey> = {
  major: "hc.changelogLevel.major",
  minor: "hc.changelogLevel.minor",
  patch: "hc.changelogLevel.patch",
};
const LEVEL_TONES: Record<"major" | "minor" | "patch", "brand" | "ok" | "neutral"> = {
  major: "brand",
  minor: "ok",
  patch: "neutral",
};
const STATUS_KEYS: Record<RoadmapItem["status"], MessageKey> = {
  planned: "admin.updates.status.planned",
  in_progress: "admin.updates.status.inProgress",
  shipped: "admin.updates.status.shipped",
};

const emptyEntry = (): Omit<ChangelogEntry, "id" | "publishedAt"> => ({
  title: "",
  description: "",
  version: "",
  level: null,
});

export function UpdatesManager({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const dateFmt = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [items, setItems] = useState<RoadmapItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Changelog-Formular (leer = neuer Eintrag, sonst Bearbeiten)
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyEntry());

  // Roadmap-Formular
  const [rmEditId, setRmEditId] = useState<string | null>(null);
  const [rmDraft, setRmDraft] = useState<{ title: string; status: RoadmapItem["status"] }>({
    title: "",
    status: "planned",
  });

  async function load() {
    try {
      const [cl, rm] = (await Promise.all([
        fetch("/api/v1/admin/changelog").then((r) => r.json()),
        fetch("/api/v1/admin/roadmap").then((r) => r.json()),
      ])) as [{ entries?: ChangelogEntry[] }, { items?: RoadmapItem[] }];
      setEntries(cl.entries ?? []);
      setItems(rm.items ?? []);
    } catch {
      setError(t("admin.updates.loadError"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        setError(res.status === 403 ? t("admin.updates.forbidden") : t("admin.updates.saveError"));
        return false;
      }
      await load();
      return true;
    } catch {
      setError(t("admin.updates.saveError"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitEntry() {
    if (draft.title.trim().length === 0) return setError(t("admin.updates.titleRequired"));
    const body = {
      title: draft.title,
      description: draft.description,
      version: draft.version,
      level: draft.level,
    };
    const ok = editId
      ? await send(`/api/v1/admin/changelog/${editId}`, "PUT", body)
      : await send("/api/v1/admin/changelog", "POST", body);
    if (ok) {
      setDraft(emptyEntry());
      setEditId(null);
    }
  }

  async function submitItem() {
    if (rmDraft.title.trim().length === 0) return setError(t("admin.updates.titleRequired"));
    const ok = rmEditId
      ? await send(`/api/v1/admin/roadmap/${rmEditId}`, "PUT", rmDraft)
      : await send("/api/v1/admin/roadmap", "POST", rmDraft);
    if (ok) {
      setRmDraft({ title: "", status: "planned" });
      setRmEditId(null);
    }
  }

  return (
    <div className="grid gap-6">
      {error ? <p className="text-sm text-crit">{error}</p> : null}

      {/* ——— Changelog ——— */}
      <section className="rounded-card border border-hairline bg-surface p-6">
        <h2 className="mb-1 font-semibold tracking-[-0.3px]">{t("admin.updates.changelogTitle")}</h2>
        <p className="mb-4 text-sm text-ink-muted">{t("admin.updates.changelogHint")}</p>

        <div className="mb-5 flex flex-col gap-3 rounded-comfy border border-hairline bg-surface-raised p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_180px]">
            <Input
              label={t("admin.updates.entryTitle")}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={t("admin.updates.entryTitlePlaceholder")}
            />
            <Input
              label={t("admin.updates.version")}
              value={draft.version ?? ""}
              onChange={(e) => setDraft({ ...draft, version: e.target.value })}
              placeholder={t("admin.updates.versionPlaceholder")}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-ink-muted">{t("admin.updates.level")}</span>
              <Select
                options={[
                  { value: "", label: t("admin.updates.levelNone") },
                  ...CHANGELOG_LEVELS.map((l) => ({ value: l, label: t(LEVEL_KEYS[l]) })),
                ]}
                value={draft.level ?? ""}
                onValueChange={(v) =>
                  setDraft({ ...draft, level: v === "" ? null : (v as ChangelogEntry["level"]) })
                }
                aria-label={t("admin.updates.level")}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">{t("admin.updates.description")}</span>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              aria-label={t("admin.updates.description")}
              className="w-full rounded-std border border-hairline bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:shadow-focusglow"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={busy} onClick={() => void submitEntry()}>
              {editId ? t("admin.updates.save") : t("admin.updates.publish")}
            </Button>
            {editId ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditId(null);
                  setDraft(emptyEntry());
                }}
              >
                {t("admin.updates.cancel")}
              </Button>
            ) : null}
          </div>
        </div>

        {entries === null ? (
          <p className="text-sm text-ink-muted">{t("admin.updates.loading")}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("admin.updates.changelogEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center gap-3 rounded-std border border-hairline px-3 py-2"
              >
                <span className="text-xs text-ink-muted">
                  {dateFmt.format(new Date(e.publishedAt * 1000))}
                </span>
                {e.version ? (
                  <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[11px] text-ink-muted">
                    {e.version}
                  </span>
                ) : null}
                {e.level ? <Badge tone={LEVEL_TONES[e.level]}>{t(LEVEL_KEYS[e.level])}</Badge> : null}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{e.title}</span>
                <Button
                  variant="cream"
                  size="sm"
                  onClick={() => {
                    setEditId(e.id);
                    setDraft({
                      title: e.title,
                      description: e.description,
                      version: e.version ?? "",
                      level: e.level,
                    });
                  }}
                >
                  <PencilIcon width={13} height={13} />
                  {t("admin.updates.edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (!window.confirm(t("admin.updates.confirmDelete", { title: e.title }))) return;
                    void send(`/api/v1/admin/changelog/${e.id}`, "DELETE");
                  }}
                >
                  <CloseIcon width={12} height={12} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ——— Roadmap ——— */}
      <section className="rounded-card border border-hairline bg-surface p-6">
        <h2 className="mb-1 font-semibold tracking-[-0.3px]">{t("admin.updates.roadmapTitle")}</h2>
        <p className="mb-4 text-sm text-ink-muted">{t("admin.updates.roadmapHint")}</p>

        <div className="mb-5 flex flex-wrap items-end gap-3 rounded-comfy border border-hairline bg-surface-raised p-4">
          <Input
            label={t("admin.updates.itemTitle")}
            value={rmDraft.title}
            onChange={(e) => setRmDraft({ ...rmDraft, title: e.target.value })}
            className="min-w-56 flex-1"
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">{t("admin.updates.status")}</span>
            <Select
              options={ROADMAP_STATUS.map((s) => ({ value: s, label: t(STATUS_KEYS[s]) }))}
              value={rmDraft.status}
              onValueChange={(v) => setRmDraft({ ...rmDraft, status: v as RoadmapItem["status"] })}
              aria-label={t("admin.updates.status")}
              className="w-44"
            />
          </div>
          <Button size="sm" disabled={busy} onClick={() => void submitItem()}>
            {rmEditId ? t("admin.updates.save") : t("admin.updates.add")}
          </Button>
          {rmEditId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRmEditId(null);
                setRmDraft({ title: "", status: "planned" });
              }}
            >
              {t("admin.updates.cancel")}
            </Button>
          ) : null}
        </div>

        {items === null ? (
          <p className="text-sm text-ink-muted">{t("admin.updates.loading")}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("admin.updates.roadmapEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-3 rounded-std border border-hairline px-3 py-2"
              >
                <Badge tone={i.status === "shipped" ? "ok" : i.status === "in_progress" ? "brand" : "neutral"}>
                  {t(STATUS_KEYS[i.status])}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{i.title}</span>
                <Button
                  variant="cream"
                  size="sm"
                  onClick={() => {
                    setRmEditId(i.id);
                    setRmDraft({ title: i.title, status: i.status });
                  }}
                >
                  <PencilIcon width={13} height={13} />
                  {t("admin.updates.edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (!window.confirm(t("admin.updates.confirmDelete", { title: i.title }))) return;
                    void send(`/api/v1/admin/roadmap/${i.id}`, "DELETE");
                  }}
                >
                  <CloseIcon width={12} height={12} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
