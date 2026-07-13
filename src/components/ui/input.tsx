import type { InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

function Field({ label, children }: { label?: ReactNode; children: ReactNode }) {
  if (!label) return <>{children}</>;
  return (
    <label className="flex flex-1 flex-col gap-1.5">
      <span className="text-sm text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

const FIELD_STYLE = cn(
  "w-full rounded-std border border-hairline bg-surface-raised px-3 py-2 text-base text-ink",
  "transition-shadow duration-150 placeholder:text-ink-muted",
  "focus:border-transparent focus:outline-none focus:shadow-[0_0_0_2px_var(--ring)]",
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Sichtbares Label (kommt vom Aufrufer, i18n-fähig). */
  label?: ReactNode;
}

export function Input({ label, className, ...rest }: InputProps) {
  return (
    <Field label={label}>
      <input className={cn(FIELD_STYLE, className)} {...rest} />
    </Field>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
}

export function Textarea({ label, className, rows = 3, ...rest }: TextareaProps) {
  return (
    <Field label={label}>
      <textarea
        rows={rows}
        className={cn(FIELD_STYLE, "min-h-[84px] resize-y leading-relaxed", className)}
        {...rest}
      />
    </Field>
  );
}
