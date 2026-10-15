import { cn } from "@/lib/utils";

// Plain (non-client) module so both Server and Client Components can use it.

export const buttonVariants = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent/90 shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.7)] active:translate-y-px",
  secondary: "bg-surface-2 text-fg border border-line hover:border-muted/50 hover:bg-surface-2/80",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  danger: "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
} as const;

export const buttonSizes = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-lg justify-center",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;
export type ButtonSize = keyof typeof buttonSizes;

const base =
  "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background,border,color,transform] duration-150";

/** Button styling as a class string, e.g. for links that look like buttons. */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(base, buttonVariants[variant], buttonSizes[size], className);
}
