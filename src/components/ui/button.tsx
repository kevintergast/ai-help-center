import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

type Variant = "primary" | "brand" | "ghost" | "cream";
type Size = "md" | "sm";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] shadow-inset",
  brand: "bg-brand text-brand-fg shadow-inset",
  ghost: "bg-transparent text-ink border border-hairline-strong",
  cream: "bg-surface text-ink border border-hairline",
};

const SIZES: Record<Size, string> = {
  md: "text-base px-4 py-2",
  sm: "text-sm px-3 py-1.5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Volle Pille (nur für Aktions-/Toggle-Buttons). */
  pill?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  pill = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 font-normal transition-[opacity,box-shadow] duration-150",
        "active:opacity-80 focus-visible:outline-none focus-visible:shadow-focusglow",
        "disabled:pointer-events-none disabled:opacity-50",
        pill ? "rounded-full" : "rounded-std",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
