"use client";

import { useState } from "react";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import { Button } from "@/components/ui/button";
import { GoogleIcon, MicrosoftIcon } from "@/components/ui/icons";
import { startSocialSignIn } from "@/lib/auth-client";
import { mapAuthError } from "@/lib/auth/errors";
import type { MessageKey } from "@/i18n/messages/de";

type Provider = "google" | "microsoft";

const LABEL_KEY: Record<Provider, MessageKey> = {
  google: "auth.social.google",
  microsoft: "auth.social.microsoft",
};

const ICON: Record<Provider, typeof GoogleIcon> = {
  google: GoogleIcon,
  microsoft: MicrosoftIcon,
};

/**
 * Social-Login-Buttons (Punkt 4a). Rendert NUR die verfügbaren Provider
 * (server-seitig aus den Env-Credentials abgeleitet → Microsoft ohne Key
 * erscheint gar nicht). Klick startet den gewrappten Gateway-Flow
 * (startSocialSignIn), der den Browser zum IdP navigiert.
 */
export function SocialButtons({
  providers,
  locale,
  callbackURL,
  errorCallbackURL,
  onError,
}: {
  providers: Provider[];
  locale: Locale;
  callbackURL: string;
  errorCallbackURL?: string;
  onError: (message: string) => void;
}) {
  const t = getT(locale);
  const [busy, setBusy] = useState<Provider | null>(null);

  if (providers.length === 0) return null;

  async function start(provider: Provider) {
    setBusy(provider);
    onError("");
    const { error } = await startSocialSignIn(provider, { callbackURL, errorCallbackURL });
    if (error) {
      onError(t(mapAuthError(error as { code?: string }, "signIn")));
      setBusy(null);
    }
    // Bei Erfolg navigiert der Browser bereits weg → kein setBusy(null) nötig.
  }

  return (
    <div className="flex flex-col gap-2">
      {providers.map((provider) => {
        const Icon = ICON[provider];
        return (
          <Button
            key={provider}
            type="button"
            variant="cream"
            onClick={() => start(provider)}
            disabled={busy !== null}
            className="w-full justify-center"
          >
            <Icon />
            {t(LABEL_KEY[provider])}
          </Button>
        );
      })}
    </div>
  );
}
