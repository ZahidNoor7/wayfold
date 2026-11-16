"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { deleteRoleAction } from "@/app/workspace/team/actions";
import { ConfirmDialog, Panel } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { RoleEditor } from "./role-editor";
import { permissionCount, roleDeleteBlock, roleEditBlock } from "./team-display";
import type { RoleView, TeamViewer } from "./types";

interface RolesSectionProps {
  roles: RoleView[];
  viewer: TeamViewer;
  /** Permission key → plain description, from the server's catalogue. */
  catalogue: Readonly<Record<string, string>>;
}

type EditorState = { mode: "create" } | { mode: "edit"; roleId: string } | null;

function usage(role: RoleView): string {
  const people = `${role.memberCount} ${role.memberCount === 1 ? "member" : "members"}`;
  if (role.openInvitationCount === 0) return people;
  return `${people} · ${role.openInvitationCount} open ${role.openInvitationCount === 1 ? "invitation" : "invitations"}`;
}

export function RolesSection({ roles, viewer, catalogue }: RolesSectionProps) {
  const [editor, setEditor] = useState<EditorState>(null);
  const [deleting, setDeleting] = useState<RoleView | null>(null);
  const total = Object.keys(catalogue).length;
  const editing = editor?.mode === "edit" ? (roles.find((role) => role.id === editor.roleId) ?? null) : null;

  const remove = useAction(deleteRoleAction, {
    toastError: false,
    success: (data) => `Role ${data.name} deleted`,
    onSuccess: () => setDeleting(null),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          A role is a set of permissions. Built-in roles cover the usual jobs; create your own when someone needs a different mix.
        </p>
        {viewer.canManageRoles ? (
          <button type="button" className="btn btn-default" onClick={() => setEditor({ mode: "create" })}>
            <Plus aria-hidden="true" />
            New role
          </button>
        ) : null}
      </div>

      <ul className="grid gap-4 lg:grid-cols-2">
        {roles.map((role) => {
          const editBlock = roleEditBlock(role, viewer.ownRoleId);
          const deleteBlock = roleDeleteBlock(role);
          const canEdit = viewer.canManageRoles && editBlock === null;
          return (
            <li key={role.id} className="card flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="flex flex-wrap items-center gap-2 font-bold text-primary">
                    {role.name}
                    {role.isSystem ? <span className="badge badge-secondary">Built-in</span> : <span className="badge badge-outline">Custom</span>}
                    {role.id === viewer.ownRoleId ? <span className="badge badge-highlight">Your role</span> : null}
                  </h3>
                  {role.description ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{role.description}</p> : null}
                </div>
              </div>
              <p className="text-[13px] text-muted-foreground">
                {permissionCount(role.permissions.length, total)} · {usage(role)}
              </p>
              <div className="mt-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  aria-label={`${canEdit ? "Edit" : "View"} the ${role.name} role`}
                  onClick={() => setEditor({ mode: "edit", roleId: role.id })}
                >
                  {canEdit ? "Edit" : "View permissions"}
                </button>
                {viewer.canManageRoles && !role.isSystem ? (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm text-destructive hover:text-destructive"
                    aria-label={`Delete the ${role.name} role`}
                    disabled={deleteBlock !== null}
                    aria-describedby={deleteBlock ? `role-block-${role.id}` : undefined}
                    onClick={() => {
                      remove.reset();
                      setDeleting(role);
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              {viewer.canManageRoles && !role.isSystem && deleteBlock ? (
                <p id={`role-block-${role.id}`} className="field-hint">
                  {deleteBlock}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Panel
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        title={editor?.mode === "create" ? "New role" : (editing?.name ?? "Role")}
        description={
          editor?.mode === "create"
            ? "Choose a name and what people with this role can do."
            : editing && viewer.canManageRoles && roleEditBlock(editing, viewer.ownRoleId) === null
              ? "Change what people with this role can do. It applies to everyone holding the role straight away."
              : "What people with this role can do."
        }
      >
        {editor?.mode === "create" ? (
          <RoleEditor key="new" role={null} viewer={viewer} catalogue={catalogue} onDone={() => setEditor(null)} />
        ) : editing ? (
          <RoleEditor
            key={editing.id}
            role={editing}
            viewer={viewer}
            catalogue={catalogue}
            readOnlyReason={!viewer.canManageRoles ? "Your role can see roles but not change them." : roleEditBlock(editing, viewer.ownRoleId)}
            onDone={() => setEditor(null)}
          />
        ) : null}
      </Panel>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete the ${deleting?.name ?? ""} role?`}
        description={
          <>
            <p>Nobody holds this role, so nothing else changes. The activity log keeps a record of the role and its permissions.</p>
            {remove.error ? (
              <p role="alert" className="mt-2 font-medium text-destructive">
                {remove.error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete role"
        destructive
        pending={remove.pending}
        onConfirm={() => {
          if (deleting) void remove.run({ roleId: deleting.id });
        }}
      />
    </div>
  );
}
