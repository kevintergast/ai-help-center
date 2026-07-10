"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/ui/cn";
import { IconButton } from "./icon-button";
import { MicIcon, SendIcon } from "./icons";

export interface PromptMode {
  id: string;
  label: string;
}

export interface PromptBoxLabels {
  send: string;
  mic: string;
}

export interface PromptBoxProps {
  placeholder: string;
  modes?: PromptMode[];
  suggestions?: string[];
  labels: PromptBoxLabels;
  onSubmit?: (text: string, mode: string) => void;
  className?: string;
}

/**
 * Zentrale KI-Eingabe (AI-First): auto-wachsendes Textfeld, Modus-Umschalter
 * (z. B. Suchen/Fragen), Vorschlags-Chips, Mikrofon + Senden. Enter sendet,
 * Shift+Enter fügt eine Zeile ein.
 */
export function PromptBox({
  placeholder,
  modes = [],
  suggestions = [],
  labels,
  onSubmit,
  className,
}: PromptBoxProps) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState(modes[0]?.id ?? "");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  function grow() {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }

  function submit() {
    const value = text.trim();
    if (!value) return;
    onSubmit?.(value, mode);
    setText("");
    requestAnimationFrame(grow);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function applySuggestion(s: string) {
    setText(s);
    const el = areaRef.current;
    if (el) {
      el.focus();
      requestAnimationFrame(grow);
    }
  }

  return (
    <div className={className}>
      <div className="rounded-container border border-hairline bg-surface-raised p-3 focus-within:border-hairline-strong">
        <textarea
          ref={areaRef}
          rows={2}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            grow();
          }}
          onKeyDown={onKey}
          className="w-full resize-none bg-transparent px-2 py-1.5 text-base leading-relaxed text-ink outline-none placeholder:text-ink-muted"
        />
        <div className="mt-2 flex items-center gap-2">
          {modes.length > 0 ? (
            <div
              role="group"
              className="flex rounded-full border border-hairline bg-surface p-0.5"
            >
              {modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={mode === m.id}
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-sm transition-colors",
                    mode === m.id
                      ? "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : null}
          <span className="flex-1" />
          <IconButton aria-label={labels.mic} className="h-9 w-9">
            <MicIcon width={16} height={16} />
          </IconButton>
          <button
            type="button"
            aria-label={labels.send}
            disabled={!text.trim()}
            onClick={submit}
            className="grid h-9 w-9 place-items-center rounded-full bg-brand text-brand-fg shadow-inset transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:shadow-focusglow disabled:opacity-40"
          >
            <SendIcon width={16} height={16} />
          </button>
        </div>
      </div>
      {suggestions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => applySuggestion(s)}
              className="rounded-full border border-hairline bg-surface px-3.5 py-2 text-sm text-ink-muted transition-colors hover:bg-tint hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
