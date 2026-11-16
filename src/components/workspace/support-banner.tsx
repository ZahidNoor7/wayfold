import { ShieldAlert } from "lucide-react";

/**
 * Shown on every page while a platform admin is inside a workspace. Support
 * access is never silent: the banner cannot be dismissed, and ending the
 * session is one click away.
 */
export function SupportBanner({ workspaceName, expiresAt }: { workspaceName: string; expiresAt: Date }) {
  const time = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(expiresAt);
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--status-pending-border)] bg-[var(--status-pending-bg)] px-5 py-2.5 text-sm text-[var(--status-pending-fg)] sm:px-8">
      <p className="flex items-center gap-2 font-medium">
        <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
        <span>
          Wayfold support session in <strong>{workspaceName}</strong>. View-only, approved by this workspace, ends {time}.
        </span>
      </p>
      <form action="/platform/support/end" method="post">
        <button type="submit" className="btn btn-outline btn-sm">
          End session
        </button>
      </form>
    </div>
  );
}
