"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare-Turnstile-Widget (explizites Rendering).
 *
 * Liefert das Token über `onToken` (null bei Ablauf/Fehler — der Aufrufer
 * blockt den Submit, solange kein Token vorliegt). Das Script wird modulweit
 * genau EINMAL geladen; jede Instanz rendert ihr eigenes Widget und räumt es
 * beim Unmount ab. Ohne `siteKey` (dev ohne Bindings) rendert der Aufrufer die
 * Komponente gar nicht erst — serverseitig ist der Schutz dann ebenfalls aus.
 */

interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      theme: "auto";
      language?: string;
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile api missing after load"));
    };
    script.onerror = () => {
      scriptPromise = null; // nächster Mount versucht es erneut
      reject(new Error("turnstile script failed"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function TurnstileWidget({
  siteKey,
  onToken,
  language,
}: {
  siteKey: string;
  /** Frisches Token; `null` = abgelaufen/Fehler (Submit wieder sperren). */
  onToken: (token: string | null) => void;
  /** Widget-Sprache (Tenant-Locale), sonst Browser-Default. */
  language?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // onToken bewusst über eine Ref entkoppeln: Turnstile darf bei Parent-
  // Re-Renders (z. B. Tippen im Formular) nicht neu gerendert werden.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let widgetId: string | null = null;
    let cancelled = false;

    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        widgetId = api.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
          theme: "auto",
          language,
        });
      })
      .catch(() => {
        // Script blockiert (Adblocker/Netz): Token bleibt null → Submit bleibt
        // gesperrt; serverseitig würde es ohnehin abgelehnt (fail-closed).
        onTokenRef.current(null);
      });

    return () => {
      cancelled = true;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, language]);

  return <div ref={containerRef} />;
}
