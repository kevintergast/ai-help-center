"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import {
  MAX_PROMPT_SUGGESTIONS,
  MAX_SUGGESTION_LENGTH,
  parsePromptSuggestions,
  MAX_PROMPT_PLACEHOLDER,
} from "@/lib/content/prompt-suggestions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { CloseIcon, PlusIcon } from "@/components/ui/icons";
import { useUnsavedGuard } from "@/lib/admin/use-unsaved-guard";
import { UnsavedGuardDialog } from "@/components/admin/unsaved-guard-dialog";

/**
 * FRAGE-VORSCHLÄGE pflegen (0044).
 *
 * Vorher standen auf JEDER Instanz dieselben drei Beispielfragen — auf einer
 * Kundeninstanz also UNSERE. Sie sind das Erste, was jemand liest, der noch
 * nicht weiß, was er fragen soll; sie gehören dem Betreiber.
 *
 * Null Vorschläge sind ausdrücklich erlaubt: Dann steht die Eingabe schlicht
 * da. Ein leeres Feld heißt „den will ich nicht" und fällt beim Speichern weg
 * — das ist bequemer als ein extra Löschknopf für jede Zeile.
 */
export function PromptSuggestionsManager({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [items, setItems] = useState<string[]>([]);
  const [pristine, setPristine] = useState("[]");
  const [placeholder, setPlaceholder] = useState("");
  const [pristinePlaceholder, setPristinePlaceholder] = useState("");
  const [state, setState] = useState<"loading" | "idle" | "saving" | "done" | "error">("loading");
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  const dirty = JSON.stringify(items) !== pristine || placeholder !== pristinePlaceholder;
  const guard = useUnsavedGuard(dirty);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/v1/admin/prompt-suggestions");
        if (!res.ok) throw new Error("load");
        const data = (await res.json()) as { suggestions: string[]; placeholder: string | null };
        if (!alive) return;
        setItems(data.suggestions);
        setPristine(JSON.stringify(data.suggestions));
        setPlaceholder(data.placeholder ?? "");
        setPristinePlaceholder(data.placeholder ?? "");
        setState("idle");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function save(): Promise<boolean> {
    const parsed = parsePromptSuggestions(items);
    if (!parsed.ok) {
      setErrorKey(
        parsed.error === "too_long"
          ? "admin.suggestions.error.tooLong"
          : "admin.suggestions.error.generic",
      );
      return false;
    }

    setState("saving");
    setErrorKey(null);
    try {
      const res = await fetch("/api/v1/admin/prompt-suggestions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggestions: parsed.suggestions, placeholder }),
      });
      if (!res.ok) throw new Error("save");
      const fresh = (await res.json()) as { suggestions: string[] };
      setItems(fresh.suggestions);
      setPristine(JSON.stringify(fresh.suggestions));
      setPristinePlaceholder(placeholder);
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
      {/* PLATZHALTER (0049) steht VOR den Vorschlägen, weil er im Feld selbst
          steht — er ist das Erste, was ein Besucher liest, und führt ihn näher
          an eine beantwortbare Frage als eine allgemeine Aufforderung. */}
      <div className="max-w-xl">
        <Input
          label={t("admin.suggestions.promptText")}
          value={placeholder}
          onChange={(e) => setPlaceholder(e.target.value)}
          placeholder={t("hc.promptPlaceholder")}
          maxLength={MAX_PROMPT_PLACEHOLDER}
        />
        <p className="mt-1 text-xs text-ink-muted">{t("admin.suggestions.promptTextHint")}</p>
      </div>

      <p className="text-xs text-ink-muted">
        {t("admin.suggestions.hint", { max: MAX_PROMPT_SUGGESTIONS })}
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("admin.suggestions.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((value, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <Input
                label={t("admin.suggestions.position", { n: i + 1 })}
                value={value}
                maxLength={MAX_SUGGESTION_LENGTH}
                onChange={(e) => {
                  setItems((xs) => xs.map((x, j) => (j === i ? e.target.value : x)));
                  setErrorKey(null);
                  setState("idle");
                }}
                placeholder={t("admin.suggestions.placeholder")}
                className="min-w-[16rem] flex-1"
              />
              <IconButton
                aria-label={t("admin.suggestions.delete")}
                onClick={() => {
                  setItems((xs) => xs.filter((_, j) => j !== i));
                  setState("idle");
                }}
                className="ml-auto"
              >
                <CloseIcon width={16} height={16} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          onClick={() => {
            setItems((xs) => [...xs, ""]);
            setState("idle");
          }}
          disabled={items.length >= MAX_PROMPT_SUGGESTIONS}
        >
          <PlusIcon width={16} height={16} />
          {t("admin.suggestions.add")}
        </Button>
        <Button onClick={() => void save()} disabled={state === "saving"}>
          {t("admin.suggestions.save")}
        </Button>
        <span aria-live="polite" className="text-xs">
          {errorKey ? (
            <span className="text-crit">{t(errorKey)}</span>
          ) : state === "done" ? (
            <span className="text-ok">{t("admin.suggestions.saved")}</span>
          ) : state === "error" ? (
            <span className="text-crit">{t("admin.suggestions.error.generic")}</span>
          ) : items.length >= MAX_PROMPT_SUGGESTIONS ? (
            <span className="text-ink-muted">
              {t("admin.suggestions.full", { max: MAX_PROMPT_SUGGESTIONS })}
            </span>
          ) : null}
        </span>
      </div>

      <UnsavedGuardDialog
        locale={locale}
        href={guard.pendingHref}
        onCancel={guard.cancel}
        onSave={save}
        onDiscard={() => setItems(JSON.parse(pristine))}
      />
    </div>
  );
}
