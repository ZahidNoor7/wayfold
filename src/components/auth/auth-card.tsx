import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AuthCardProps {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Quiet line under the card: the way to the neighbouring page. */
  footer?: ReactNode;
  /** Icon for a finished or informational state; centres the card. */
  mark?: ReactNode;
  /** Announce the card when it replaces a form (success states). */
  announce?: boolean;
  className?: string;
}

/** The card every single-form account page is built from. One `h1` each. */
export function AuthCard({ title, description, children, footer, mark, announce, className }: AuthCardProps) {
  return (
    <>
      <div role={announce ? "status" : undefined} className={cn("card p-6 sm:p-9", mark ? "text-center" : null, announce ? "animate-rise" : null, className)}>
        {mark ? (
          <div className="mb-6">
            <DoneMark>{mark}</DoneMark>
          </div>
        ) : null}
        <h1 className="font-display text-3xl font-semibold leading-tight text-primary sm:text-4xl">{title}</h1>
        {description ? (
          <p className={cn("mt-2 text-sm leading-relaxed text-muted-foreground sm:text-[15px]", mark ? "mx-auto max-w-sm" : null)}>{description}</p>
        ) : null}
        {children ? <div className="mt-7">{children}</div> : null}
      </div>
      {footer ? <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p> : null}
    </>
  );
}

/** Round mark used on finished states, as on the design's "message sent" screen. */
export function DoneMark({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-16 w-16 animate-pop items-center justify-center rounded-full bg-primary text-highlight [&>svg]:size-8">{children}</span>
  );
}

/** Text link in the weight and colour the design uses for inline actions. */
export const TEXT_LINK = "font-semibold text-primary underline underline-offset-4 hover:no-underline";

interface NoticeProps {
  tone?: "success" | "info";
  children: ReactNode;
  className?: string;
}

/** A short, calm message above a form: something went well, or context for the task. */
export function Notice({ tone = "info", children, className }: NoticeProps) {
  return (
    <p
      role="status"
      className={cn(
        "alert text-left",
        tone === "success"
          ? "border-[color:var(--status-confirmed-border)] bg-[color:var(--status-confirmed-bg)] text-[color:var(--status-confirmed-fg)]"
          : "bg-secondary/60 text-secondary-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Holds the card's shape while the session or link is being checked. */
export function AuthCardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="card flex flex-col gap-5 p-6 sm:p-9">
      <div className="skeleton h-9 w-44" />
      <div className="skeleton h-4 w-64 max-w-full" />
      <div className="mt-2 flex flex-col gap-4">
        <div className="skeleton h-11" />
        <div className="skeleton h-11" />
        <div className="skeleton h-12" />
      </div>
    </div>
  );
}
