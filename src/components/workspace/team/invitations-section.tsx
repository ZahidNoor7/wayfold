"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { inviteMemberAction, resendInvitationAction, revokeInvitationAction } from "@/app/workspace/team/actions";
import { Field, firstError, SubmitButton } from "@/components/form";
import { ConfirmDialog, Panel, Spinner } from "@/components/overlays";
import { EmptyState } from "@/components/workspace/page-header";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { grantableRoles, invitationExpiry, seatsFull, seatSummary } from "./team-display";
import type { InvitationView, RoleView, SeatUsage, TeamViewer } from "./types";

interface InvitationsSectionProps {
  invitations: InvitationView[];
  roles: RoleView[];
  viewer: TeamViewer;
  seats: SeatUsage;
  /** Server render time, so expiry text matches what the server counted. */
  nowIso: string;
}

function PlanLimitNote({ viewer }: { viewer: TeamViewer }) {
  return viewer.canSeeBilling ? (
    <>
      {" "}
      <Link href="/workspace/billing" className="font-semibold underline underline-offset-4">
        See plans with more seats
      </Link>
      .
    </>
  ) : (
    " Ask an owner to move the workspace to a larger plan."
  );
}

export function InvitationsSection({ invitations, roles, viewer, seats, nowIso }: InvitationsSectionProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revoking, setRevoking] = useState<InvitationView | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const now = new Date(nowIso);
  const full = seatsFull(seats.used, seats.limit);
  const percent = seats.limit ? Math.min(100, Math.round((seats.used / seats.limit) * 100)) : null;

  const resend = useAction(resendInvitationAction, {
    success: (data) => `Invitation sent again to ${data.email}`,
    onSuccess: () => setResendingId(null),
  });
  const revoke = useAction(revokeInvitationAction, {
    toastError: false,
    success: "Invitation withdrawn",
    onSuccess: () => setRevoking(null),
  });

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="seat-usage" className="card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="seat-usage" className="font-semibold">
              Seats
            </h2>
            <p className="text-sm text-muted-foreground">{seatSummary(seats.used, seats.limit)}</p>
          </div>
          {viewer.canManageTeam ? (
            <button type="button" className="btn btn-default" onClick={() => setInviteOpen(true)} disabled={full}>
              <MailPlus aria-hidden="true" />
              Invite someone
            </button>
          ) : null}
        </div>
        {percent !== null ? (
          <div className="progress" role="progressbar" aria-label="Seats used" aria-valuemin={0} aria-valuemax={seats.limit ?? 0} aria-valuenow={seats.used}>
            <div className={cn("h-full rounded-full", full ? "bg-destructive" : percent > 80 ? "bg-[var(--status-pending-fg)]" : "bg-primary")} style={{ width: `${percent}%` }} />
          </div>
        ) : null}
        {full ? (
          <p className="alert alert-warning" role="status">
            Every seat on your plan is taken. Free one by deactivating a member or withdrawing an invitation, or upgrade.
            <PlanLimitNote viewer={viewer} />
          </p>
        ) : null}
      </section>

      {invitations.length === 0 ? (
        <EmptyState
          title="No pending invitations"
          description="Invite a colleague by e-mail and choose their role. They get a link that works for seven days; until they accept, the invitation holds a seat."
          action={
            viewer.canManageTeam && !full ? (
              <button type="button" className="btn btn-default" onClick={() => setInviteOpen(true)}>
                Invite someone
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y">
            {invitations.map((invitation) => {
              const expiry = invitationExpiry(new Date(invitation.expiresAt), now);
              const resending = resend.pending && resendingId === invitation.id;
              return (
                <li key={invitation.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate font-bold">{invitation.email}</span>
                      {expiry.expired ? <span className="badge badge-cancelled">Expired</span> : <span className="badge badge-pending">Pending</span>}
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      {invitation.roleName}
                      {invitation.invitedByName ? ` · invited by ${invitation.invitedByName}` : ""} ·{" "}
                      <span className={expiry.expired ? "font-semibold text-destructive" : undefined}>{expiry.text}</span>
                    </span>
                  </div>
                  {viewer.canManageTeam ? (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={resend.pending}
                        aria-busy={resending || undefined}
                        aria-label={`Send the invitation to ${invitation.email} again`}
                        onClick={() => {
                          setResendingId(invitation.id);
                          void resend.run({ invitationId: invitation.id });
                        }}
                      >
                        {resending ? <Spinner /> : null}
                        Resend
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm text-destructive hover:text-destructive"
                        aria-label={`Withdraw the invitation to ${invitation.email}`}
                        onClick={() => {
                          revoke.reset();
                          setRevoking(invitation);
                        }}
                      >
                        Withdraw
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="border-t px-4 py-3 text-[13px] text-muted-foreground sm:px-6">
            Resending creates a new link and a fresh seven days; the old link stops working.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title="Withdraw this invitation?"
        description={
          <>
            <p>
              The link sent to <strong className="text-foreground">{revoking?.email}</strong> will stop working and the seat becomes free. You can invite them again later.
            </p>
            {revoke.error ? (
              <p role="alert" className="mt-2 font-medium text-destructive">
                {revoke.error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Withdraw invitation"
        destructive
        pending={revoke.pending}
        onConfirm={() => {
          if (revoking) void revoke.run({ invitationId: revoking.id });
        }}
      />

      <Panel open={inviteOpen} onOpenChange={setInviteOpen} title="Invite someone" description="They will get an e-mail with a link to join this workspace.">
        {inviteOpen ? <InviteForm roles={roles} viewer={viewer} onDone={() => setInviteOpen(false)} /> : null}
      </Panel>
    </div>
  );
}

const inviteSchema = z.object({
  email: z.string().trim().max(254, "Enter a valid e-mail address.").pipe(z.email("Enter a valid e-mail address.")),
  roleId: z.string().min(1, "Choose a role."),
});
type InviteValues = z.infer<typeof inviteSchema>;

function InviteForm({ roles, viewer, onDone }: { roles: RoleView[]; viewer: TeamViewer; onDone: () => void }) {
  const options = grantableRoles(viewer, roles);
  const fallback = options.find((role) => role.systemKey === "staff") ?? options.find((role) => role.systemKey !== "owner") ?? options[0];
  const form = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { email: "", roleId: fallback?.id ?? "" } });
  const { errors } = form.formState;
  const roleId = useWatch({ control: form.control, name: "roleId" });
  const selectedRole = roles.find((role) => role.id === roleId);

  const { run, pending, error, fieldErrors } = useAction(inviteMemberAction, {
    toastError: false,
    success: (data) => `Invitation sent to ${data.email}`,
    onSuccess: onDone,
  });
  const [code, setCode] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setCode(null);
    const result = await run(values);
    if (!result.ok) {
      setCode(result.code);
      if (result.code === "already_member" || result.code === "invitation_pending") {
        form.setError("email", { message: result.error }, { shouldFocus: true });
      }
    }
  });

  const message = (name: keyof InviteValues) => errors[name]?.message ?? firstError(fieldErrors, name);
  const formLevel = error && !fieldErrors && !errors.email ? error : null;

  if (options.length === 0) {
    return (
      <div className="p-5 sm:p-6">
        <p className="alert text-muted-foreground">There is no role you can give someone: every role includes permissions you do not hold yourself.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5 p-5 sm:p-6">
      {formLevel ? (
        <div role="alert" className="alert alert-destructive">
          {formLevel}
          {code === "plan_limit" ? <PlanLimitNote viewer={viewer} /> : null}
        </div>
      ) : null}
      <Field label="E-mail address" error={message("email")}>
        {(control) => (
          <input {...control} {...form.register("email")} className="input" type="email" inputMode="email" autoComplete="off" spellCheck={false} />
        )}
      </Field>
      <Field
        label="Role"
        error={message("roleId")}
        hint={selectedRole?.description || "You can only give roles whose permissions you hold yourself."}
      >
        {(control) => (
          <select {...control} {...form.register("roleId")} className="select">
            {options.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send invitation
        </SubmitButton>
        <button type="button" className="btn btn-outline" onClick={onDone} disabled={pending}>
          Cancel
        </button>
      </div>
      <p className="field-hint">The invitation link works for seven days. Until it is accepted or withdrawn, it holds one of your plan&rsquo;s seats.</p>
    </form>
  );
}
