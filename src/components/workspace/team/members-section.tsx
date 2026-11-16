"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { changeMemberRoleAction, deactivateMemberAction, reactivateMemberAction, removeMemberAction } from "@/app/workspace/team/actions";
import { FormError } from "@/components/form";
import { ConfirmDialog, Panel, Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { formatDate } from "@/lib/booking-display";
import { todayIn } from "@/lib/dates";
import { grantableRoles, memberLockReason } from "./team-display";
import type { MemberView, RoleView, TeamViewer } from "./types";

interface MembersSectionProps {
  members: MemberView[];
  roles: RoleView[];
  viewer: TeamViewer;
  timezone: string;
}

function StatusBadge({ status }: { status: MemberView["status"] }) {
  return status === "active" ? <span className="badge badge-confirmed">Active</span> : <span className="badge badge-secondary">Deactivated</span>;
}

export function MembersSection({ members, roles, viewer, timezone }: MembersSectionProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = members.find((member) => member.id === openId) ?? null;
  const joined = (member: MemberView) => formatDate(todayIn(timezone, member.joinedAt));
  const actionLabel = viewer.canManageTeam ? "Manage" : "View";

  return (
    <>
      <div className="card overflow-hidden">
        <div className="hidden overflow-x-auto md:block">
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th scope="col" className="pl-6">
                  Name
                </th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Joined</th>
                <th scope="col" className="pr-6">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isYou = member.userId === viewer.userId;
                return (
                  <tr key={member.id}>
                    <td className="pl-6">
                      <span className="flex items-center gap-2 font-bold text-primary">
                        {member.name}
                        {isYou ? <span className="badge badge-outline">You</span> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{member.email}</span>
                    </td>
                    <td>{member.roleName}</td>
                    <td>
                      <StatusBadge status={member.status} />
                    </td>
                    <td className="whitespace-nowrap text-muted-foreground">{joined(member)}</td>
                    <td className="pr-6 text-right">
                      <button type="button" className="btn btn-outline btn-sm" aria-label={`${actionLabel} ${member.name}`} onClick={() => setOpenId(member.id)}>
                        {actionLabel}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <ul className="divide-y md:hidden">
          {members.map((member) => (
            <li key={member.id}>
              <button type="button" className="flex w-full flex-col gap-1.5 p-4 text-left hover:bg-muted/50" onClick={() => setOpenId(member.id)}>
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-bold">
                    {member.name}
                    {member.userId === viewer.userId ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
                  </span>
                  <StatusBadge status={member.status} />
                </span>
                <span className="truncate text-sm text-muted-foreground">{member.email}</span>
                <span className="flex w-full justify-between gap-3 text-[13px]">
                  <span>{member.roleName}</span>
                  <span className="text-muted-foreground">Joined {joined(member)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="border-t px-4 py-3 text-[13px] text-muted-foreground sm:px-6">
          {members.length} {members.length === 1 ? "member" : "members"}
          {viewer.canManageTeam ? " · select a member to change their role or access" : ""}
        </div>
      </div>

      <Panel
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        title={selected?.name ?? "Team member"}
        description={selected?.email}
      >
        {selected ? <MemberDetail key={selected.id} member={selected} roles={roles} viewer={viewer} timezone={timezone} onRemoved={() => setOpenId(null)} /> : null}
      </Panel>
    </>
  );
}

interface MemberDetailProps {
  member: MemberView;
  roles: RoleView[];
  viewer: TeamViewer;
  timezone: string;
  onRemoved: () => void;
}

function MemberDetail({ member, roles, viewer, timezone, onRemoved }: MemberDetailProps) {
  const lock = memberLockReason(member, viewer);
  const editable = viewer.canManageTeam && lock === null;
  const options = grantableRoles(viewer, roles);
  // The current role stays visible even when the viewer could not grant it.
  const roleOptions = options.some((role) => role.id === member.roleId) ? options : [...roles.filter((role) => role.id === member.roleId), ...options];
  const [roleId, setRoleId] = useState(member.roleId);
  const [confirm, setConfirm] = useState<"deactivate" | "remove" | null>(null);

  const changeRole = useAction(changeMemberRoleAction, {
    toastError: false,
    success: (data) => `${data.name} is now ${data.roleName}`,
  });
  const deactivate = useAction(deactivateMemberAction, {
    toastError: false,
    success: (data) => `${data.name} deactivated`,
    onSuccess: () => setConfirm(null),
  });
  const reactivate = useAction(reactivateMemberAction, { toastError: false, success: (data) => `${data.name} reactivated` });
  const remove = useAction(removeMemberAction, {
    toastError: false,
    success: `${member.name} removed from the workspace`,
    onSuccess: () => {
      setConfirm(null);
      onRemoved();
    },
  });

  const error = changeRole.error ?? deactivate.error ?? reactivate.error ?? remove.error;
  const busy = changeRole.pending || deactivate.pending || reactivate.pending || remove.pending;

  function resetErrors() {
    changeRole.reset();
    deactivate.reset();
    reactivate.reset();
    remove.reset();
  }

  return (
    <div className="flex flex-col gap-6 p-5 sm:p-6">
      <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2.5 text-sm">
        <dt className="text-muted-foreground">Role</dt>
        <dd className="font-semibold">{member.roleName}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>{member.status === "active" ? "Active" : "Deactivated: cannot sign in to this workspace"}</dd>
        <dt className="text-muted-foreground">Joined</dt>
        <dd>{formatDate(todayIn(timezone, member.joinedAt))}</dd>
      </dl>

      {lock ? (
        <p className="alert flex gap-2.5 text-muted-foreground">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{lock}</span>
        </p>
      ) : !viewer.canManageTeam ? (
        <p className="alert text-muted-foreground">Your role can see the team but not change it.</p>
      ) : null}

      <FormError message={error} />

      {editable ? (
        <>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              resetErrors();
              void changeRole.run({ membershipId: member.id, roleId });
            }}
          >
            <label htmlFor="member-role" className="label">
              Change role
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select id="member-role" className="select" value={roleId} onChange={(event) => setRoleId(event.target.value)} disabled={busy}>
                {roleOptions.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn-default shrink-0" disabled={busy || roleId === member.roleId} aria-busy={changeRole.pending || undefined}>
                {changeRole.pending ? <Spinner /> : null}
                Save role
              </button>
            </div>
            <span className="field-hint">You can only give roles whose permissions you hold yourself.</span>
          </form>

          <div className="separator" />

          <section aria-labelledby="member-access" className="flex flex-col gap-3">
            <h3 id="member-access" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Access
            </h3>
            <div className="flex flex-wrap gap-2">
              {member.status === "active" ? (
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setConfirm("deactivate")}>
                  Deactivate
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={busy}
                  aria-busy={reactivate.pending || undefined}
                  onClick={() => {
                    resetErrors();
                    void reactivate.run({ membershipId: member.id });
                  }}
                >
                  {reactivate.pending ? <Spinner /> : null}
                  Reactivate
                </button>
              )}
              <button type="button" className="btn btn-outline text-destructive hover:text-destructive" disabled={busy} onClick={() => setConfirm("remove")}>
                Remove from workspace
              </button>
            </div>
            <p className="field-hint">
              Deactivating keeps their history and frees their seat; you can reactivate them later. Removing takes them off the team entirely.
            </p>
          </section>
        </>
      ) : null}

      <ConfirmDialog
        open={confirm === "deactivate"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={`Deactivate ${member.name}?`}
        description={
          <>
            <p>They will be signed out of this workspace straight away and their seat becomes free. Everything they did stays in the activity log.</p>
            {deactivate.error ? (
              <p role="alert" className="mt-2 font-medium text-destructive">
                {deactivate.error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Deactivate"
        destructive
        pending={deactivate.pending}
        onConfirm={() => {
          resetErrors();
          void deactivate.run({ membershipId: member.id });
        }}
      />
      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={`Remove ${member.name}?`}
        description={
          <>
            <p>They lose access to this workspace. To bring them back you will need to invite them again.</p>
            {remove.error ? (
              <p role="alert" className="mt-2 font-medium text-destructive">
                {remove.error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Remove"
        destructive
        pending={remove.pending}
        onConfirm={() => {
          resetErrors();
          void remove.run({ membershipId: member.id });
        }}
      />
    </div>
  );
}
