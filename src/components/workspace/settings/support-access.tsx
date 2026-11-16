"use client";

import { Clock, LifeBuoy, ShieldCheck, ShieldOff } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { approveSupportGrantAction, denySupportGrantAction, revokeSupportGrantAction } from "@/app/workspace/settings/support/actions";
import { ConfirmDialog, Spinner } from "@/components/overlays";
import { EmptyState } from "@/components/workspace/page-header";
import { useAction } from "@/hooks/use-action";
import { formatDateTime } from "@/lib/booking-display";
import { cn } from "@/lib/utils";
import { ACCESS_DURATIONS, DEFAULT_ACCESS_HOURS, GRANT_STATUS_META, groupGrants, timeLeft } from "./support";

export interface GrantItem {
  id: string;
  reason: string;
  status: "requested" | "approved" | "denied" | "revoked" | "expired";
  createdAt: Date;
  decidedAt: Date | null;
  expiresAt: Date | null;
  /** Name of the team member who decided, when known. */
  decidedByName: string | null;
}

interface SupportAccessProps {
  grants: GrantItem[];
  timezone: string;
  /** Server time when the page rendered, so the first paint matches. */
  renderedAt: Date;
}

/** Ticks once a minute so "time left" stays true while the page is open. */
function useMinuteClock(start: Date): Date {
  const [now, setNow] = useState(start);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function SupportAccess({ grants, timezone, renderedAt }: SupportAccessProps) {
  const now = useMinuteClock(renderedAt);
  const { pending, active, history } = groupGrants(grants, now);
  const [revoking, setRevoking] = useState<GrantItem | null>(null);
  const revoke = useAction(revokeSupportGrantAction, {
    success: "Support access revoked",
    onSuccess: () => setRevoking(null),
  });

  if (grants.length === 0) {
    return (
      <EmptyState
        title="No support requests"
        description="When Wayfold support needs to look at your workspace to help you, their request appears here for you to approve or deny. Nobody from Wayfold can open your workspace without it."
      />
    );
  }

  const when = (date: Date | null) => (date ? formatDateTime(date, timezone) : "—");

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <section className="card" aria-labelledby="support-pending">
        <div className="card-header">
          <h2 id="support-pending" className="card-title">
            Waiting for your decision
          </h2>
          <p className="card-description">Approve only requests you expect, for example after contacting support yourself.</p>
        </div>
        <div className="card-content">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests are waiting.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {pending.map((grant) => (
                <PendingRequest key={grant.id} grant={grant} requestedAt={when(grant.createdAt)} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="support-active">
        <div className="card-header">
          <h2 id="support-active" className="card-title">
            Open access
          </h2>
          <p className="card-description">Support can view your workspace until the time shown. Revoke it as soon as you no longer need help.</p>
        </div>
        <div className="card-content">
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">Wayfold support has no access to your workspace right now.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {active.map((grant) => (
                <li key={grant.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="badge badge-confirmed">
                        <ShieldCheck aria-hidden="true" className="size-3.5" />
                        Access open
                      </span>
                      <span className="text-sm font-semibold">{timeLeft(grant.expiresAt, now)}</span>
                    </p>
                    <p className="mt-2 text-sm">{grant.reason}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Until {when(grant.expiresAt)}
                      {grant.decidedByName ? `, approved by ${grant.decidedByName}` : ""}
                    </p>
                  </div>
                  <button type="button" className="btn btn-outline shrink-0 text-destructive" onClick={() => setRevoking(grant)}>
                    <ShieldOff aria-hidden="true" />
                    Revoke access
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {history.length > 0 ? (
        <section className="card" aria-labelledby="support-history">
          <div className="card-header">
            <h2 id="support-history" className="card-title">
              History
            </h2>
            <p className="card-description">Earlier requests and how they ended. Every support visit is also in the activity log.</p>
          </div>
          <div className="card-content">
            <ul className="flex flex-col divide-y">
              {history.map((grant) => {
                const meta = GRANT_STATUS_META[grant.status];
                return (
                  <li key={grant.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <div className="min-w-0">
                      <p className="text-sm">{grant.reason}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Requested {when(grant.createdAt)}
                        {grant.decidedByName ? ` · decided by ${grant.decidedByName}` : ""}
                        {grant.status === "expired" && grant.expiresAt ? ` · ended ${when(grant.expiresAt)}` : ""}
                      </p>
                    </div>
                    <span className={cn("badge shrink-0 self-start", meta.badge)}>{meta.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke support access?"
        description="Wayfold support loses access straight away and is signed out of your workspace. If they still need to help, they will have to ask again."
        confirmLabel="Revoke access"
        destructive
        pending={revoke.pending}
        onConfirm={() => revoking && revoke.run({ id: revoking.id })}
      />
    </div>
  );
}

function PendingRequest({ grant, requestedAt }: { grant: GrantItem; requestedAt: string }) {
  const groupId = useId();
  const [hours, setHours] = useState(DEFAULT_ACCESS_HOURS);
  const choice = ACCESS_DURATIONS.find((option) => option.hours === hours) ?? ACCESS_DURATIONS[1]!;
  const approve = useAction(approveSupportGrantAction, { success: `Support can view your workspace for ${choice.label}` });
  const deny = useAction(denySupportGrantAction, { success: "Support request denied" });
  const busy = approve.pending || deny.pending;

  return (
    <li className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
          <LifeBuoy className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Wayfold support asks to view your workspace</p>
          <p className="mt-1 text-sm">“{grant.reason}”</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock aria-hidden="true" className="size-3.5" />
            Requested {requestedAt}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p id={groupId} className="label">
          Allow access for
        </p>
        <div role="radiogroup" aria-labelledby={groupId} className="flex flex-wrap gap-2">
          {ACCESS_DURATIONS.map((option) => (
            <label key={option.hours} className="chip cursor-pointer has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring">
              <input type="radio" name={`${groupId}-hours`} value={option.hours} checked={hours === option.hours} onChange={() => setHours(option.hours)} className="sr-only" />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => deny.run({ id: grant.id })} aria-busy={deny.pending || undefined}>
          {deny.pending ? <Spinner /> : null}
          Deny
        </button>
        <button type="button" className="btn btn-default" disabled={busy} onClick={() => approve.run({ id: grant.id, hours })} aria-busy={approve.pending || undefined}>
          {approve.pending ? <Spinner /> : <ShieldCheck aria-hidden="true" />}
          Approve for {choice.label}
        </button>
      </div>
    </li>
  );
}
