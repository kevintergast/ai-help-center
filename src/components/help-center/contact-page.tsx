"use client";

import type { HelpViewer } from "@/lib/auth/viewer";
import type { Locale } from "@/lib/tenant/types";
import type { HelpCenterData } from "@/lib/content/types";
import { contactMethodHref, type ContactMethod } from "@/lib/content/contact-methods";
import { getT } from "@/i18n/t";
import { HelpShell } from "./help-shell";
import { SupportTicketForm } from "./support-ticket-form";
import { InboxIcon, PhoneIcon, SendIcon } from "@/components/ui/icons";

/**
 * KONTAKTSEITE (`/contact`, Migration 0037) — der Ausweg, wenn Artikel und
 * KI-Antwort nicht weiterhelfen.
 *
 * JEDER WEG IST EINE KARTE, und die Karte sagt, was passiert: Adresse und
 * Rufnummer sind echte `mailto:`/`tel:`-Links (ein Klick auf dem Handy
 * wählt), das Formular klappt an Ort und Stelle auf, statt woandershin zu
 * führen — wer hier landet, ist schon einmal nicht weitergekommen.
 *
 * Es gibt keinen Leerzustand: Ohne gepflegten Weg erscheint weder Link noch
 * Seite (die Route antwortet dann mit 404).
 */
export function ContactPage({
  locale,
  tenantName,
  logoUrl,
  logoDarkUrl,
  faviconUrl,
  showName,
  data,
  isOperator,
  viewer,
}: {
  locale: Locale;
  tenantName: string;
  logoUrl: string | null;
  logoDarkUrl?: string | null;
  /** Favicon (0031) — das quadratische Zeichen im Legal-Fuß. */
  faviconUrl?: string | null;
  showName?: boolean;
  data: HelpCenterData;
  isOperator?: boolean;
  viewer?: HelpViewer | null;
}) {
  const t = getT(locale);

  return (
    <HelpShell
      locale={locale}
      tenantName={tenantName}
      logoUrl={logoUrl}
      logoDarkUrl={logoDarkUrl}
      faviconUrl={faviconUrl}
      showName={showName}
      data={data}
      isOperator={isOperator}
      viewer={viewer}
      activeContact
    >
      <div className="px-5 py-8 md:px-10">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.6px] md:text-[34px]">
            {t("hc.contact.title")}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">{t("hc.contact.intro")}</p>

          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.contactMethods.map((method) => (
              <li key={method.id} className={method.kind === "form" ? "sm:col-span-2" : undefined}>
                <MethodCard method={method} locale={locale} t={t} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </HelpShell>
  );
}

const CARD =
  "flex h-full flex-col gap-1 rounded-card border border-hairline bg-surface p-5 transition-colors";

function MethodCard({
  method,
  locale,
  t,
}: {
  method: ContactMethod;
  locale: Locale;
  t: ReturnType<typeof getT>;
}) {
  const head = (
    <>
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        <MethodIcon kind={method.kind} />
        {method.title}
      </span>
      {method.description.length > 0 ? (
        <span className="text-[13px] leading-snug text-ink-muted">{method.description}</span>
      ) : null}
    </>
  );

  if (method.kind === "form") {
    return (
      <div className={CARD}>
        {head}
        {/* `question={null}`: Hier gibt es keine vorangegangene KI-Antwort,
            die als Kontext mitreisen könnte — anders als unter einer Antwort. */}
        <SupportTicketForm
          locale={locale}
          question={null}
          className="mt-2"
          alwaysOpen
          bare
          requireEmail
        />
      </div>
    );
  }

  const href = contactMethodHref(method);
  return (
    <a href={href ?? "#"} className={`${CARD} hover:border-brand/40 hover:bg-tint`}>
      {head}
      <span className="mt-1 break-words text-sm text-brand">{method.value}</span>
      <span className="sr-only">
        {method.kind === "email" ? t("hc.contact.emailHint") : t("hc.contact.phoneHint")}
      </span>
    </a>
  );
}

function MethodIcon({ kind }: { kind: ContactMethod["kind"] }) {
  const props = { width: 16, height: 16, className: "shrink-0 opacity-70" } as const;
  if (kind === "phone") return <PhoneIcon {...props} />;
  if (kind === "form") return <SendIcon {...props} />;
  return <InboxIcon {...props} />;
}
