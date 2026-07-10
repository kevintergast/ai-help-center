import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Etwas stärker abgerundeter, größerer Container. */
  featured?: boolean;
  children: ReactNode;
}

/** Container mit Rand statt Schatten (Level 1) auf Cream-Fläche. */
export function Card({ featured = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "border border-hairline bg-surface",
        featured ? "rounded-container p-7" : "rounded-card p-6",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
