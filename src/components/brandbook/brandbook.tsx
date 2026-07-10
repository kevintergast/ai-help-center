"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { SearchBar } from "@/components/ui/search-bar";
import { Banner } from "@/components/ui/banner";
import { Meter } from "@/components/ui/meter";
import { Stat, StatRow } from "@/components/ui/stat";
import { ArticleCard } from "@/components/ui/article-card";
import { AnswerBlock } from "@/components/ui/answer-block";
import { PromptBox } from "@/components/ui/prompt-box";
import { SearchCombobox } from "@/components/ui/search-combobox";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { Accordion } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { FeedbackBar } from "@/components/ui/feedback-bar";
import { Dialog } from "@/components/ui/dialog";
import { Toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { MicIcon, DocIcon, CopyIcon, InfoIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";
import * as c from "./brandbook-content";

function Band({ section, children }: { section: c.Section; children: ReactNode }) {
  return (
    <section
      id={section.id}
      className="mx-auto max-w-book border-b border-hairline px-6 py-16 last:border-b-0 md:py-20"
    >
      <header className="mb-9 max-w-[60ch]">
        <span className="mb-2.5 block text-[13px] uppercase tracking-[0.14em] text-ink-muted">
          {section.eyebrow}
        </span>
        <h2 className="mb-3 text-[32px] font-semibold tracking-[-0.9px] text-ink [text-wrap:balance] md:text-4xl">
          {section.title}
        </h2>
        <p className="text-ink-muted">{section.desc}</p>
      </header>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2.5 mt-6 text-[13px] text-ink-muted first:mt-0">{children}</p>;
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3.5">{children}</div>;
}

function StatusBadge({ status }: { status: c.StatusKey }) {
  const s = c.statusMap[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export function Brandbook() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [accent, setAccent] = useState(c.accents[0].value);
  const [copied, setCopied] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 2600);
  }

  function pickAccent(value: string) {
    setAccent(value);
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty("--brand-primary", value);
    el.style.setProperty("--brand-primary-fg", value === "#1c1c1c" ? "#fcfbf8" : "#ffffff");
  }

  function copy(value: string) {
    setCopied(value);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
    window.setTimeout(() => setCopied((cur) => (cur === value ? null : cur)), 1200);
  }

  return (
    <div ref={rootRef} className="min-h-screen bg-surface font-sans text-ink">
      {/* Hero */}
      <header className="relative overflow-hidden border-b border-hairline px-6 pb-16 pt-20 md:pt-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-40 z-0 h-[520px] blur-md"
          style={{
            background:
              "radial-gradient(38% 55% at 18% 20%, rgba(255,177,238,.32), transparent 70%), radial-gradient(40% 60% at 78% 12%, rgba(255,186,120,.28), transparent 72%), radial-gradient(46% 62% at 60% 48%, rgba(120,170,255,.26), transparent 74%)",
          }}
        />
        <div className="relative z-10 mx-auto max-w-book">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-comfy bg-[var(--btn-primary-bg)] text-[20px] font-semibold tracking-[-0.5px] text-[var(--btn-primary-fg)] shadow-inset">
                {c.hero.brandInitial}
              </span>
              <span className="text-[19px] font-semibold tracking-[-0.4px]">{c.hero.brandName}</span>
            </div>
            <ThemeToggle label={c.themeToggleLabel} />
          </div>
          <p className="mb-4 mt-7 text-[13px] uppercase tracking-[0.14em] text-ink-muted">
            {c.hero.eyebrow}
          </p>
          <h1 className="mb-5 max-w-[16ch] text-[44px] font-semibold leading-[1.05] tracking-[-1.5px] [text-wrap:balance] md:text-[60px]">
            {c.hero.title}
          </h1>
          <p className="max-w-[60ch] text-lg leading-snug text-ink-muted">{c.hero.lede}</p>
        </div>
      </header>

      {/* Sticky Sprungnav */}
      <nav
        aria-label={c.hero.eyebrow}
        className="sticky top-0 z-40 border-b border-hairline bg-surface"
      >
        <div className="mx-auto flex max-w-book flex-wrap gap-1 px-5 py-2.5">
          {c.nav.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              className="rounded-std px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-tint focus-visible:shadow-focusglow focus-visible:outline-none"
            >
              {n.label}
            </a>
          ))}
        </div>
      </nav>

      <main>
        {/* Farben */}
        <Band section={c.sections.farben}>
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            {c.swatches.map((sw) => (
              <button
                key={sw.name}
                onClick={() => copy(sw.value)}
                className="overflow-hidden rounded-comfy border border-hairline text-left focus-visible:shadow-focusglow focus-visible:outline-none"
                aria-label={sw.name}
              >
                <span className="block h-[76px]" style={{ background: sw.value }} />
                <span className="block px-3 py-2.5">
                  <span className="block text-sm font-semibold">{sw.name}</span>
                  <span className="mt-0.5 flex items-center justify-between text-xs text-ink-muted">
                    <span className="tabular-nums">{sw.value}</span>
                    <span className={cn(copied === sw.value ? "text-brand" : "text-ink-muted")}>
                      <CopyIcon width={13} height={13} />
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Band>

        {/* Typografie */}
        <Band section={c.sections.typografie}>
          <Card>
            {c.typeScale.map((t) => (
              <div
                key={t.spec}
                className="flex flex-col gap-2 border-b border-hairline py-3.5 last:border-b-0 md:flex-row md:items-baseline md:gap-5"
              >
                <div className="w-[210px] shrink-0 text-[13px] tabular-nums text-ink-muted">
                  {t.spec}
                </div>
                <div className="min-w-0 text-ink" style={t.style}>
                  {t.sample}
                </div>
              </div>
            ))}
          </Card>
        </Band>

        {/* Raster & Radius */}
        <Band section={c.sections.raster}>
          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <Label>{c.sections.raster.title}</Label>
              <div className="flex flex-wrap gap-5">
                {c.radii.map((r) => (
                  <div key={r.label} className="text-center">
                    <div
                      className="mb-2 h-[62px] w-[84px] border border-hairline-strong bg-tint"
                      style={{ borderRadius: r.value }}
                    />
                    <div className="text-xs tabular-nums text-ink-muted">{r.label}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <Label>{c.hero.eyebrow}</Label>
              <div className="flex flex-col gap-2.5">
                {c.spacing.map((v) => (
                  <div key={v} className="flex items-center gap-3.5">
                    <span className="w-14 text-xs tabular-nums text-ink-muted">{v}</span>
                    <span
                      className="h-3.5 rounded-[3px] bg-brand opacity-85"
                      style={{ width: `${v}px` }}
                    />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </Band>

        {/* Tiefe */}
        <Band section={c.sections.tiefe}>
          <div className="flex flex-wrap gap-5">
            {c.elevation.map((e) => (
              <div
                key={e.label}
                className={cn(
                  "grid h-24 w-40 place-items-center rounded-card p-2 text-center text-[13px]",
                  e.kind === "bordered" && "border border-hairline bg-surface text-ink-muted",
                  e.kind === "inset" &&
                    "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] shadow-inset",
                  e.kind === "focus" && "border border-hairline bg-surface text-ink-muted shadow-focusglow",
                  e.kind === "ring" &&
                    "border border-hairline bg-surface text-ink-muted shadow-[0_0_0_2px_var(--ring)]",
                )}
              >
                {e.label}
              </div>
            ))}
          </div>
        </Band>

        {/* White-Label */}
        <Band section={c.sections.whitelabel}>
          <Card>
            <Label>{c.whitelabel.choose}</Label>
            <div className="flex flex-wrap items-center gap-3">
              {c.accents.map((a) => (
                <button
                  key={a.value}
                  onClick={() => pickAccent(a.value)}
                  aria-label={a.name}
                  aria-pressed={accent === a.value}
                  className={cn(
                    "h-9 w-9 rounded-full border-2 border-hairline transition-transform hover:scale-110",
                    accent === a.value &&
                      "shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]",
                  )}
                  style={{ background: a.value }}
                />
              ))}
              <span className="ml-1.5 text-sm text-ink-muted">{c.whitelabel.affects}</span>
            </div>
            <Row>
              <div className="mt-5 flex w-full flex-wrap items-center gap-3.5">
                <Button variant="brand">{c.whitelabel.cta}</Button>
                <a
                  href={`#${c.sections.whitelabel.id}`}
                  className="text-ink underline decoration-1 underline-offset-2 hover:text-brand"
                >
                  {c.whitelabel.docs}
                </a>
                <Badge tone="brand" dot>
                  {c.whitelabel.plan}
                </Badge>
              </div>
            </Row>
          </Card>
        </Band>

        {/* Buttons */}
        <Band section={c.sections.buttons}>
          <Label>{c.buttonLabels.variants}</Label>
          <Row>
            <Button variant="primary">{c.buttonLabels.primary}</Button>
            <Button variant="brand">{c.buttonLabels.brand}</Button>
            <Button variant="ghost">{c.buttonLabels.ghost}</Button>
            <Button variant="cream">{c.buttonLabels.cream}</Button>
            <Button variant="primary" size="sm">
              {c.buttonLabels.small}
            </Button>
            <Button variant="cream" pill>
              {c.buttonLabels.pill}
            </Button>
            <IconButton aria-label={c.buttonLabels.micDesc}>
              <MicIcon width={17} height={17} />
            </IconButton>
          </Row>
        </Band>

        {/* Formulare */}
        <Band section={c.sections.formulare}>
          <Card>
            <div className="flex flex-wrap items-start gap-3.5">
              <Input label={c.forms.email} type="email" placeholder={c.forms.emailPh} />
              <Input label={c.forms.title} type="text" defaultValue={c.forms.titleVal} />
            </div>
            <div className="mt-5">
              <Textarea label={c.forms.desc} placeholder={c.forms.descPh} />
            </div>
          </Card>
        </Band>

        {/* Badges */}
        <Band section={c.sections.badges}>
          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <Label>{c.badges.statusHead}</Label>
              <div className="flex flex-wrap gap-3">
                <Badge tone="ok" dot>
                  {c.badges.current}
                </Badge>
                <Badge tone="warn" dot>
                  {c.badges.stale}
                </Badge>
                <Badge tone="crit" dot>
                  {c.badges.frozen}
                </Badge>
                <Badge dot>{c.badges.draft}</Badge>
                <Badge tone="brand" dot>
                  {c.badges.ai}
                </Badge>
              </div>
            </Card>
            <Card>
              <Label>{c.badges.suggestHead}</Label>
              <div className="flex flex-wrap gap-2.5">
                {c.badges.suggestions.map((s) => (
                  <button
                    key={s}
                    className="rounded-full border border-hairline bg-surface px-3.5 py-2 text-sm text-ink-muted transition-colors hover:bg-tint"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Card>
          </div>
        </Band>

        {/* Navigation */}
        <Band section={c.sections.navigation}>
          <div className="overflow-hidden rounded-container border border-hairline">
            <div className="flex items-center gap-3 border-b border-hairline bg-surface px-4 py-3">
              <span className="grid h-[30px] w-[30px] place-items-center rounded-std bg-brand text-[15px] font-semibold text-brand-fg">
                {c.shell.initial}
              </span>
              <span className="font-semibold tracking-[-0.3px]">{c.shell.tenant}</span>
              <div className="ml-4 hidden gap-4 sm:flex">
                {c.shell.links.map((l) => (
                  <a key={l} href="#navigation" className="text-sm text-ink-muted hover:text-ink">
                    {l}
                  </a>
                ))}
              </div>
              <span className="flex-1" />
              <Button variant="primary" size="sm">
                {c.shell.cta}
              </Button>
            </div>
            <div className="px-5 py-5 text-sm text-ink-muted">{c.shell.body}</div>
          </div>
        </Band>

        {/* Suche & KI */}
        <Band section={c.sections.suche}>
          <div className="flex flex-col gap-6">
            <SearchBar placeholder={c.searchDemo.placeholder} className="max-w-xl" />
            <AnswerBlock
              heading={c.searchDemo.answerHeading}
              status={
                <Badge tone="ok" dot>
                  {c.searchDemo.grounded}
                </Badge>
              }
              citations={c.searchDemo.citations}
            >
              {c.searchDemo.answerBody}
            </AnswerBlock>
          </div>
        </Band>

        {/* Artikel */}
        <Band section={c.sections.artikel}>
          <Label>{c.articles.galleryLabel}</Label>
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
            {c.articles.cards.map((a) => (
              <ArticleCard
                key={a.title}
                category={a.category}
                title={a.title}
                excerpt={a.excerpt}
                status={<StatusBadge status={a.status} />}
              />
            ))}
          </div>
          <Label>{c.articles.listLabel}</Label>
          <div className="flex flex-col gap-2.5">
            {c.articles.rows.map((r) => (
              <div
                key={r.title}
                className="flex cursor-pointer items-center gap-3.5 rounded-comfy border border-hairline bg-surface px-4 py-4 transition-colors hover:bg-tint"
              >
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-std bg-tint text-ink-muted">
                  <DocIcon width={17} height={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold text-ink">{r.title}</span>
                  <span className="block text-[13px] text-ink-muted">{r.meta}</span>
                </span>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </Band>

        {/* KI-Prompt */}
        <Band section={c.sections.prompt}>
          <PromptBox
            placeholder={c.promptDemo.placeholder}
            modes={c.promptDemo.modes}
            suggestions={c.promptDemo.suggestions}
            labels={{ send: c.promptDemo.send, mic: c.promptDemo.mic }}
            onSubmit={() => showToast(c.promptDemo.sentToast)}
            className="max-w-2xl"
          />
        </Band>

        {/* Live-Suche */}
        <Band section={c.sections["suche-live"]}>
          <SearchCombobox
            items={c.liveSearch.items}
            placeholder={c.liveSearch.placeholder}
            emptyLabel={c.liveSearch.emptyLabel}
            aria-label={c.liveSearch.ariaLabel}
            className="max-w-xl"
          />
        </Band>

        {/* Dropdown & Auswahl */}
        <Band section={c.sections.dropdown}>
          <Card>
            <div className="flex flex-wrap items-end gap-6">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-ink-muted">{c.dropdownDemo.filterLabel}</span>
                <Select
                  options={c.dropdownDemo.categories}
                  defaultValue="all"
                  placeholder={c.dropdownDemo.categoryPlaceholder}
                  aria-label={c.dropdownDemo.categoryAria}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-ink-muted">{c.dropdownDemo.sortSectionLabel}</span>
                <Select
                  options={c.dropdownDemo.sorts}
                  defaultValue="relevance"
                  aria-label={c.dropdownDemo.sortAria}
                />
              </div>
            </div>
          </Card>
        </Band>

        {/* Tabs */}
        <Band section={c.sections.tabs}>
          <Tabs
            aria-label={c.tabsDemo.ariaLabel}
            tabs={c.tabsDemo.items.map((t) => ({
              id: t.id,
              label: t.label,
              content: <p className="text-ink-muted">{t.body}</p>,
            }))}
          />
        </Band>

        {/* FAQ / Accordion */}
        <Band section={c.sections.faq}>
          <Accordion items={c.faqDemo.items} />
        </Band>

        {/* Schalter, Feedback & Overlays */}
        <Band section={c.sections.controls}>
          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <Label>{c.controls.switchesLabel}</Label>
              <div className="flex flex-col gap-4">
                <Switch defaultChecked label={c.controls.switchEmail} />
                <Switch label={c.controls.switchDigest} />
              </div>
            </Card>
            <Card>
              <Label>{c.controls.overlaysLabel}</Label>
              <div className="flex flex-col gap-4">
                <FeedbackBar
                  labels={{
                    question: c.controls.feedbackQuestion,
                    yes: c.controls.feedbackYes,
                    no: c.controls.feedbackNo,
                    thanks: c.controls.feedbackThanks,
                  }}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="ghost" onClick={() => setDialogOpen(true)}>
                    {c.controls.openDialog}
                  </Button>
                  <Button variant="cream" onClick={() => showToast(c.controls.toastMessage)}>
                    {c.controls.showToast}
                  </Button>
                  <Tooltip label={c.controls.tooltipText}>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1.5 text-sm text-ink-muted">
                      <InfoIcon width={15} height={15} />
                      {c.controls.tooltipTrigger}
                    </span>
                  </Tooltip>
                </div>
              </div>
            </Card>
          </div>
        </Band>

        {/* Admin */}
        <Band section={c.sections.admin}>
          <Banner
            tone="warn"
            title={c.admin.bannerTitle}
            description={c.admin.bannerDesc}
            action={
              <Button variant="primary" size="sm">
                {c.admin.upgrade}
              </Button>
            }
            className="mb-6"
          />

          <div className="mb-6 grid gap-5 md:grid-cols-2">
            <Card featured>
              <div className="mb-5 flex items-baseline justify-between">
                <h4 className="text-[15px] font-normal text-ink-muted">{c.admin.planHead}</h4>
                <span className="text-[22px] font-semibold tracking-[-0.5px]">
                  {c.admin.planName}
                  <span className="text-sm font-normal text-ink-muted">{c.admin.planPer}</span>
                </span>
              </div>
              <Meter
                label={c.admin.credits}
                value={c.admin.creditsVal}
                percent={100}
                warn
                className="my-4"
              />
              <Meter label={c.admin.mau} value={c.admin.mauVal} percent={62} className="my-4" />
              <div className="mt-4 flex flex-wrap items-center gap-3.5">
                <Button variant="primary" size="sm">
                  {c.admin.managePlan}
                </Button>
                <a
                  href="#admin"
                  className="text-sm text-ink underline decoration-1 underline-offset-2 hover:text-brand"
                >
                  {c.admin.usageDetail}
                </a>
              </div>
            </Card>
            <Card featured>
              <h4 className="mb-5 text-[15px] font-normal text-ink-muted">{c.admin.monthHead}</h4>
              <StatRow>
                <Stat value={c.admin.stats[0].value} label={c.admin.stats[0].label} />
                <Stat value={c.admin.stats[1].value} label={c.admin.stats[1].label} />
              </StatRow>
              <StatRow className="mt-6">
                <Stat value={c.admin.stats[2].value} label={c.admin.stats[2].label} />
                <Stat value={c.admin.stats[3].value} label={c.admin.stats[3].label} />
              </StatRow>
            </Card>
          </div>

          <Label>{c.admin.tableLabel}</Label>
          <div className="overflow-x-auto rounded-card border border-hairline">
            <table className="w-full min-w-[460px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-hairline px-4 py-3 text-left text-[13px] font-semibold text-ink-muted">
                    {c.admin.tableHead.article}
                  </th>
                  <th className="border-b border-hairline px-4 py-3 text-left text-[13px] font-semibold text-ink-muted">
                    {c.admin.tableHead.category}
                  </th>
                  <th className="border-b border-hairline px-4 py-3 text-left text-[13px] font-semibold text-ink-muted">
                    {c.admin.tableHead.views}
                  </th>
                  <th className="border-b border-hairline px-4 py-3 text-left text-[13px] font-semibold text-ink-muted">
                    {c.admin.tableHead.status}
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.admin.tableRows.map((r) => (
                  <tr key={r.article}>
                    <td className="border-b border-hairline px-4 py-3 text-ink last:border-b-0">
                      {r.article}
                    </td>
                    <td className="border-b border-hairline px-4 py-3 text-ink">{r.category}</td>
                    <td className="border-b border-hairline px-4 py-3 tabular-nums text-ink">
                      {r.views}
                    </td>
                    <td className="border-b border-hairline px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Label>{c.admin.emptyLabel}</Label>
          <div className="rounded-card border border-dashed border-hairline-strong bg-tint px-6 py-11 text-center">
            <span className="mx-auto mb-3.5 grid h-11 w-11 place-items-center rounded-full border border-hairline bg-surface text-ink-muted">
              <DocIcon width={20} height={20} />
            </span>
            <h4 className="mb-1.5 text-[17px] font-semibold text-ink">{c.admin.emptyTitle}</h4>
            <p className="mx-auto mb-4 max-w-[42ch] text-sm text-ink-muted">
              {c.admin.emptyDesc}
            </p>
            <Button variant="primary">{c.admin.emptyCta}</Button>
          </div>
        </Band>
      </main>

      <footer className="mx-auto max-w-book px-6 pb-16 pt-10">
        <hr className="mb-6 border-hairline" />
        <p className="text-[13px] text-ink-muted">{c.footerNote}</p>
      </footer>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={c.controls.dialogTitle}
        closeLabel={c.controls.dialogClose}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
              {c.controls.dialogCancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setDialogOpen(false);
                showToast(c.controls.toastMessage);
              }}
            >
              {c.controls.dialogConfirm}
            </Button>
          </>
        }
      >
        {c.controls.dialogBody}
      </Dialog>

      <Toast
        open={toast !== null}
        message={toast}
        onClose={() => setToast(null)}
        closeLabel={c.controls.toastClose}
      />
    </div>
  );
}
