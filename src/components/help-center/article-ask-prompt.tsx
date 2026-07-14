"use client";

import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { PromptBox } from "@/components/ui/prompt-box";
import { PENDING_ASK_KEY } from "./help-center";

/**
 * Untere KI-Eingabe der (SSR-)Artikelseite. Beim Absenden wird die Frage per
 * sessionStorage an die Startansicht übergeben und dorthin navigiert, wo die
 * geerdete Antwort erscheint (der Artikel-Client bleibt so schlank/SEO-freundlich).
 */
export function ArticleAskPrompt({
  locale,
  suggestions,
}: {
  locale: Locale;
  suggestions: string[];
}) {
  const t = getT(locale);
  const router = useRouter();

  function submit(text: string) {
    try {
      sessionStorage.setItem(PENDING_ASK_KEY, text);
    } catch {
      /* ignore */
    }
    router.push("/");
  }

  return (
    <PromptBox
      expandable
      placeholder={t("hc.promptPlaceholder")}
      modes={[
        { id: "ask", label: t("hc.modeAsk") },
        { id: "search", label: t("hc.modeSearch") },
      ]}
      suggestions={suggestions}
      labels={{ send: t("hc.promptSend"), mic: t("hc.promptMic") }}
      onSubmit={submit}
    />
  );
}
