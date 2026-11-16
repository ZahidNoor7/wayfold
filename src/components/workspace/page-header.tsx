import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Primary actions for the page, right-aligned on wide screens. */
  actions?: ReactNode;
  className?: string;
}

/** The heading block every dashboard page opens with. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8", className)}>
      <div className="min-w-0 max-w-2xl">
        <h1 className="font-display text-3xl font-semibold leading-tight text-primary sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

interface EmptyStateProps {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** An empty list is an invitation: say what belongs here and how to add it. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("card flex flex-col items-center border-dashed p-10 text-center sm:p-14", className)}>
      <p className="font-display text-2xl font-semibold text-primary sm:text-3xl">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/** Placeholder that holds a page's shape while its data loads. */
export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="skeleton h-9 w-56" />
        <div className="skeleton h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-24" />
        ))}
      </div>
      <div className="card flex flex-col gap-3 p-5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton h-11" />
        ))}
      </div>
    </div>
  );
}
