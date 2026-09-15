"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import {
  ENTRY_CARD_KINDS,
  MAX_ENTRY_CARDS,
  parseEntryCardInput,
  type EntryCard,
  type EntryCardKind,
} from "@/lib/content/entry-cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { IconButton } from "@/components/ui/icon-button";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";

/**
 * EINSTIEGS-KARTEN pflegen (Migration 0035).
 *
 * SOFORT ÖFFENTLICH — wie Changelog und Roadmap gibt es keinen Entwurf. Der
 * Hinweis steht deshalb über der Liste und nicht im Kleingedruckten.
 *
 * GESPEICHERT WIRD DER GANZE SATZ in EINEM Aufruf (PUT, serverseitig ein
 * Batch aus Löschen + Anlegen — die Startseite steht nie leer). Bei
 * höchstens sechs Karten ist das einfacher und vorhersehbarer als vier
 * Einzeloperationen mit Id-Abgleich — und es ist genau das, was das
 * MCP-Werkzeug `set_entry_cards` tut, also EIN Verhalten für beide Türen.
 *
 * Das Ziel wird VOR dem Senden mit derselben Funktion geprüft, die der Server
 * benutzt (`parseEntryCardInput`) — der Fehler steht dann am Feld statt als
 * anonymes „400" nach dem Klick.
 */

type Draft = Omit<EntryCard, "id"> & { key: string };

const KIND_LABELS: Record<EntryCardKind, MessageKey> = {
  article: "admin.entryCards.kind.article",
  roadmap: "admin.entryCards.kind.roadmap",
  changelog: "admin.entryCards.kind.changelog",
  url: "admin.entryCards.kind.url",
};

const ERROR_KEYS: Record<string, MessageKey> = {
  title_required: "admin.entryCards.error.title_required",
  title_too_long: "admin.entryCards.error.title_too_long",
  description_too_long: "admin.entryCards.error.description_too_long",
  target_required: "admin.entryCards.error.target_required",
  invalid_slug: "admin.entryCards.error.invalid_slug",
  invalid_url: "admin.entryCards.error.invalid_url",
  invalid_kind: "admin.entryCards.error.generic",
};

let seq = 0;
const nextKey = () => `draft_${(seq += 1)}`;

export function EntryCardsManager({
  locale,
  articles,
}: {
  locale: Locale;
  /** Veröffentlichte Artikel als Auswahl — eine Karte darf nie ins Leere zeigen. */
  articles: { slug: string; title: string }[];
}) {
  const t = getT(locale);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [state, setState] = useState<"loading" | "idle" | "saving" | "done" | "error">("loading");
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/v1/admin/entry-cards");
        if (!res.ok) throw new Error("load");
        const data = (await res.json()) as { cards: EntryCard[] };
        if (!alive) return;
        setDrafts(data.cards.map((c) => ({ ...c, key: nextKey() })));
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

  function add() {
    setDrafts((ds) => [
      ...ds,
      { key: nextKey(), kind: "article", title: "", description: "", target: "" },
    ]);
    setState("idle");
  }

  async function save() {
    // Erst prüfen, dann senden — mit derselben Funktion wie der Server.
    const cards: Omit<EntryCard, "id">[] = [];
    for (const d of drafts) {
      const res = parseEntryCardInput(d);
      if (!res.ok) {
        setErrorKey(ERROR_KEYS[res.error] ?? "admin.entryCards.error.generic");
        setState("idle");
        return;
      }
      cards.push(res.card);
    }

    setState("saving");
    setErrorKey(null);
    try {
      // EIN Aufruf für den ganzen Satz — sonst stünde die Startseite zwischen
      // „alle gelöscht" und „neu angelegt" für jeden Besucher leer da.
      const res = await fetch("/api/v1/admin/entry-cards", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cards }),
      });
      if (!res.ok) throw new Error("save");
      const fresh = (await res.json()) as { cards: EntryCard[] };
      setDrafts(fresh.cards.map((c) => ({ ...c, key: nextKey() })));
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "loading") return <p className="text-sm text-ink-muted">…</p>;

  const articleOptions = articles.map((a) => ({ value: a.slug, label: a.title }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-muted">
        {t("admin.entryCards.hint", { max: MAX_ENTRY_CARDS })}
      </p>

      {drafts.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("admin.entryCards.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {drafts.map((d) => (
            <li
              key={d.key}
              className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-44 shrink-0">
                  <span className="mb-1 block text-xs text-ink-muted">
                    {t("admin.entryCards.kind")}
                  </span>
                  <Select
                    options={ENTRY_CARD_KINDS.map((k) => ({
                      value: k,
                      label: t(KIND_LABELS[k]),
                    }))}
                    value={d.kind}
                    // Bei einem Artwechsel ist das alte Ziel bedeutungslos —
                    // ein Slug im URL-Feld wäre eine stille Fehlerquelle.
                    onValueChange={(v) =>
                      patch(d.key, { kind: v as EntryCardKind, target: "" })
                    }
                    aria-label={t("admin.entryCards.kind")}
                  />
                </div>
                <Input
                  label={t("admin.entryCards.cardTitle")}
                  value={d.title}
                  onChange={(e) => patch(d.key, { title: e.target.value })}
                  placeholder={t("admin.entryCards.cardTitlePlaceholder")}
                  className="flex-1"
                />
                <IconButton
                  aria-label={t("admin.entryCards.delete")}
                  onClick={() => {
                    setDrafts((ds) => ds.filter((x) => x.key !== d.key));
                    setState("idle");
                  }}
                  className="mt-6"
                >
                  <CloseIcon width={16} height={16} />
                </IconButton>
              </div>

              <Input
                label={t("admin.entryCards.description")}
                value={d.description}
                onChange={(e) => patch(d.key, { description: e.target.value })}
                placeholder={t("admin.entryCards.descriptionPlaceholder")}
              />

              {d.kind === "article" ? (
                <div>
                  <span className="mb-1 block text-xs text-ink-muted">
                    {t("admin.entryCards.article")}
                  </span>
                  <Select
                    options={articleOptions}
                    value={d.target}
                    onValueChange={(v) => patch(d.key, { target: v })}
                    placeholder={t("admin.entryCards.articlePlaceholder")}
                    aria-label={t("admin.entryCards.article")}
                  />
                </div>
              ) : d.kind === "url" ? (
                <Input
                  label={t("admin.entryCards.url")}
                  type="url"
                  value={d.target}
                  onChange={(e) => patch(d.key, { target: e.target.value })}
                  placeholder={t("admin.entryCards.urlPlaceholder")}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={add} disabled={drafts.length >= MAX_ENTRY_CARDS}>
          <PlusIcon width={16} height={16} />
          {t("admin.entryCards.add")}
        </Button>
        <Button onClick={() => void save()} disabled={state === "saving"}>
          {t("admin.entryCards.save")}
        </Button>
        <span aria-live="polite" className="text-xs">
          {errorKey ? (
            <span className="text-crit">{t(errorKey)}</span>
          ) : state === "done" ? (
            <span className="text-ok">{t("admin.entryCards.saved")}</span>
          ) : state === "error" ? (
            <span className="text-crit">{t("admin.entryCards.error.generic")}</span>
          ) : drafts.length >= MAX_ENTRY_CARDS ? (
            <span className="text-ink-muted">
              {t("admin.entryCards.full", { max: MAX_ENTRY_CARDS })}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
