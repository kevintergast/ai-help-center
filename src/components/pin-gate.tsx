"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { checkPin } from "@/lib/brandbook/pin";
import { Button } from "@/components/ui/button";
import { LockIcon } from "@/components/ui/icons";

const KEY = "hh-brandbook-unlocked";

export interface PinGateLabels {
  title: string;
  hint: string;
  placeholder: string;
  submit: string;
  error: string;
}

export interface PinGateProps {
  labels: PinGateLabels;
  children: ReactNode;
}

/**
 * Clientseitiges PIN-Gate für interne Dev-/Test-Seiten. Bewusst simpel:
 * verbirgt die Seite, schützt aber keine sensiblen Daten (PIN ist im Client-Bundle).
 */
export function PinGate({ labels, children }: PinGateProps) {
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY) === "1") setUnlocked(true);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (checkPin(value)) {
      setUnlocked(true);
      setError(false);
      try {
        sessionStorage.setItem(KEY, "1");
      } catch {
        /* ignore */
      }
    } else {
      setError(true);
    }
  }

  if (!ready) return null;
  if (unlocked) return <>{children}</>;

  return (
    <div className="grid min-h-screen place-items-center bg-surface px-6 text-ink">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-container border border-hairline bg-surface-raised p-7"
      >
        <span className="mb-4 grid h-11 w-11 place-items-center rounded-full border border-hairline bg-surface text-ink-muted">
          <LockIcon width={20} height={20} />
        </span>
        <h1 className="text-xl font-semibold tracking-[-0.3px]">{labels.title}</h1>
        <p className="mb-5 mt-1 text-sm text-ink-muted">{labels.hint}</p>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          placeholder={labels.placeholder}
          aria-label={labels.title}
          aria-invalid={error}
          className="w-full rounded-std border border-hairline bg-surface px-3 py-2 text-base text-ink outline-none placeholder:text-ink-muted focus:border-transparent focus:shadow-[0_0_0_2px_var(--ring)]"
        />
        {error ? (
          <p className="mt-2 text-sm text-crit" role="alert">
            {labels.error}
          </p>
        ) : null}
        <Button type="submit" className="mt-5 w-full">
          {labels.submit}
        </Button>
      </form>
    </div>
  );
}
