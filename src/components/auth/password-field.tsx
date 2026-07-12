"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";

const FIELD_STYLE = cn(
  "w-full rounded-std border border-hairline bg-surface-raised px-3 py-2 pr-20 text-base text-ink",
  "transition-shadow duration-150 placeholder:text-ink-muted",
  "focus:border-transparent focus:outline-none focus:shadow-[0_0_0_2px_var(--ring)]",
);

/**
 * Passwort-Feld mit Anzeigen/Verbergen-Umschalter. Zugänglich: sichtbares
 * Label, der Toggle trägt ein `aria-label` und `aria-pressed`. Der Toggle ist
 * `type="button"`, damit er das Formular nicht absendet.
 */
export function PasswordField({
  locale,
  label,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { locale: Locale; label: ReactNode }) {
  const t = getT(locale);
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-muted">{label}</span>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          className={cn(FIELD_STYLE, className)}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? t("auth.password.hide") : t("auth.password.show")}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-sm text-ink-muted hover:text-ink"
        >
          {visible ? t("auth.password.hide") : t("auth.password.show")}
        </button>
      </div>
    </label>
  );
}
