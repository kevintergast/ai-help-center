import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getT } from "@/i18n/t";
import type { MessageKey } from "@/i18n/messages/de";
import { getCurrentTenant } from "@/lib/tenant/current";
import { SimpleMarkdown } from "@/lib/markdown/simple-markdown-view";
import { getDbSafe } from "@/server/db/client";
import { D1LegalRepository } from "@/server/legal/store";
import type { LegalDocType } from "@/server/legal/validate";

/**
 * ÖFFENTLICHE Rechtstexte-Seite (`/legal/<doc>`, Design h) — Ziel der Links im
 * Hilfezentrum-Footer. `link`-Modus → direkte Weiterleitung auf die externe
 * URL (bereits beim Speichern https-validiert); `markdown`-Modus → sicherer
 * Renderer (kein Roh-HTML); nicht hinterlegt → ehrlicher Hinweis (nicht 404:
 * die Links stehen im Footer jeder Instanz, eine Fehlerseite wäre irreführend).
 * Deutsche UND englische Pfad-Namen werden akzeptiert.
 */

const DOC_SLUGS: Record<string, LegalDocType> = {
  impressum: "imprint",
  imprint: "imprint",
  datenschutz: "privacy",
  privacy: "privacy",
  agb: "terms",
  terms: "terms",
};

const DOC_TITLE: Record<LegalDocType, MessageKey> = {
  imprint: "hc.legal.imprint",
  privacy: "hc.legal.privacy",
  terms: "hc.legal.terms",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doc: string }>;
}): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  const { doc } = await params;
  const docType = DOC_SLUGS[doc.toLowerCase()];
  if (!tenant || !docType) return {};
  const t = getT(tenant.defaultLocale);
  return { title: `${t(DOC_TITLE[docType])} · ${tenant.name}`, robots: { index: false } };
}

export default async function LegalDocPage({ params }: { params: Promise<{ doc: string }> }) {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const { doc } = await params;
  const docType = DOC_SLUGS[doc.toLowerCase()];
  if (!docType) notFound();

  const t = getT(tenant.defaultLocale);
  const db = await getDbSafe();
  const record = db ? await new D1LegalRepository(db).get(tenant.id, docType) : null;

  if (record?.mode === "link" && record.url) redirect(record.url);

  return (
    <div className="min-h-screen bg-surface text-ink">
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <Link
          href="/"
          className="text-sm text-ink-muted transition-colors hover:text-ink"
        >
          {t("hc.backToOverview")}
        </Link>
        <h1 className="mb-6 mt-4 text-[30px] font-semibold leading-tight tracking-[-0.6px]">
          {t(DOC_TITLE[docType])}
        </h1>
        {record?.mode === "markdown" && record.markdown ? (
          <SimpleMarkdown markdown={record.markdown} />
        ) : (
          <p className="text-ink-muted">{t("legal.notProvided", { tenant: tenant.name })}</p>
        )}
      </main>
    </div>
  );
}
