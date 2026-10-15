import { cn } from "@/lib/utils";

/** The primary content container. Header is optional. */
export function Panel({
  title,
  description,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface shadow-card", className)}>
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-line/70 px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-semibold text-fg">{title}</h2>
            {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

const tones = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-accent/12 text-accent border-accent/25",
  danger: "bg-danger/12 text-danger border-danger/25",
  warning: "bg-warning/12 text-warning border-warning/25",
  success: "bg-success/12 text-success border-success/25",
  info: "bg-info/12 text-info border-info/25",
} as const;

export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl border border-line bg-surface-2 text-accent">{icon}</div>
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {children ? <p className="mt-1 max-w-sm text-sm text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
