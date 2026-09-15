"use client";

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { Locale } from "@/lib/tenant/types";
import type { ArticleSummary } from "@/lib/content/types";
import { getT } from "@/i18n/t";
import {
  dropArticle,
  dropCategory,
  isDirty,
  moveArticle,
  moveCategory,
  toGroups,
} from "@/lib/admin/nav-order";
import { ARTICLE_STATUS } from "@/components/admin/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DocIcon, GridIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * REIHENFOLGE DER NAVIGATION pflegen (Migration 0034).
 *
 * BEDIENUNG DOPPELT: Ziehen mit der Maus UND Pfeiltasten auf dem Griff. Drag &
 * Drop allein ist für Tastatur- und Screenreader-Nutzung unbedienbar; die
 * Pfeiltasten sind hier kein Zusatz, sondern der zweite gleichwertige Weg.
 *
 * ZWEI EBENEN, EINE WAHRHEIT: Kategorien lassen sich als Block verschieben,
 * Artikel innerhalb ihrer Kategorie. Gespeichert wird beides als EINE flache
 * Id-Liste — die Kategorie-Position ergibt sich daraus, wo ihr erster Artikel
 * steht. Die Rechnung dazu liegt in `lib/admin/nav-order.ts` (getestet).
 *
 * NICHT MÖGLICH: einen Artikel in eine fremde Kategorie ziehen. Das wäre eine
 * Umkategorisierung, keine Sortierung — sie gehört in den Artikel-Editor.
 */
export function NavOrderManager({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [list, setList] = useState<ArticleSummary[]>([]);
  const [saved, setSaved] = useState<ArticleSummary[]>([]);
  const [state, setState] = useState<"loading" | "idle" | "saving" | "done" | "error">("loading");
  const dragged = useRef<{ kind: "article" | "category"; key: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/v1/admin/articles/order");
        if (!res.ok) throw new Error("load");
        const data = (await res.json()) as { articles: ArticleSummary[] };
        if (!alive) return;
        setList(data.articles);
        setSaved(data.articles);
        setState("idle");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const dirty = isDirty(saved, list);

  function apply(next: ArticleSummary[]) {
    setList(next);
    setState("idle");
  }

  async function save() {
    setState("saving");
    try {
      const res = await fetch("/api/v1/admin/articles/order", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: list.map((a) => a.id) }),
      });
      if (!res.ok) throw new Error("save");
      setSaved(list);
      setState("done");
    } catch {
      setState("error");
    }
  }

  /** Pfeiltasten auf dem Griff — der gleichwertige Weg ohne Maus. */
  function onKey(e: KeyboardEvent, move: (dir: -1 | 1) => void) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    move(e.key === "ArrowUp" ? -1 : 1);
  }

  function onDrop(e: DragEvent, kind: "article" | "category", key: string) {
    e.preventDefault();
    const from = dragged.current;
    dragged.current = null;
    if (!from || from.kind !== kind) return;
    apply(
      kind === "article" ? dropArticle(list, from.key, key) : dropCategory(list, from.key, key),
    );
  }

  if (state === "loading") return <p className="text-sm text-ink-muted">…</p>;
  if (list.length === 0) {
    return <p className="text-sm text-ink-muted">{t("admin.navOrder.empty")}</p>;
  }

  const groups = toGroups(list);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-muted">{t("admin.navOrder.hint")}</p>

      <ul className="flex flex-col gap-4">
        {groups.map((group) => (
          <li
            key={group.category}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, "category", group.category)}
          >
            <div
              draggable
              onDragStart={() => {
                dragged.current = { kind: "category", key: group.category };
              }}
              tabIndex={0}
              role="button"
              aria-label={t("admin.navOrder.handleAria", { title: group.category })}
              onKeyDown={(e) => onKey(e, (dir) => apply(moveCategory(list, group.category, dir)))}
              className="mb-1.5 flex cursor-grab items-center gap-2 rounded-comfy px-2 py-1 text-xs uppercase tracking-[0.08em] text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:cursor-grabbing"
            >
              <GridIcon width={13} height={13} className="shrink-0 opacity-60" aria-hidden />
              {group.category}
            </div>

            <ul className="flex flex-col gap-0.5">
              {group.articles.map((article) => (
                <li
                  key={article.id}
                  draggable
                  onDragStart={() => {
                    dragged.current = { kind: "article", key: article.id };
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDrop(e, "article", article.id)}
                  tabIndex={0}
                  aria-label={t("admin.navOrder.handleAria", { title: article.title })}
                  onKeyDown={(e) => onKey(e, (dir) => apply(moveArticle(list, article.id, dir)))}
                  className={cn(
                    "flex cursor-grab items-center gap-2 rounded-comfy border border-transparent px-2 py-1.5 text-sm",
                    "hover:border-hairline hover:bg-tint",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                    "active:cursor-grabbing",
                  )}
                >
                  <DocIcon width={15} height={15} className="shrink-0 opacity-60" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{article.title}</span>
                  {article.flag ? (
                    <Badge tone={article.flag.color} className="shrink-0 px-1.5 py-0.5 text-[10px]">
                      {article.flag.text}
                    </Badge>
                  ) : null}
                  {article.status === "draft" ? (
                    <Badge tone={ARTICLE_STATUS.draft.tone} className="shrink-0 px-1.5 py-0.5 text-[10px]">
                      {t(ARTICLE_STATUS.draft.key)}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={!dirty || state === "saving"}>
          {t("admin.navOrder.save")}
        </Button>
        <span aria-live="polite" className="text-xs">
          {state === "done" && !dirty ? (
            <span className="text-ok">{t("admin.navOrder.saved")}</span>
          ) : state === "error" ? (
            <span className="text-crit">{t("admin.entryCards.error.generic")}</span>
          ) : dirty ? (
            <span className="text-ink-muted">{t("admin.navOrder.unsaved")}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
