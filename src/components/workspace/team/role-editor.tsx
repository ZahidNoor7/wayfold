"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createRoleAction, updateRoleAction } from "@/app/workspace/team/actions";
import { Field, firstError, FormError, SubmitButton } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import { canGrantRole, groupPermissions, permissionCount } from "./team-display";
import type { RoleView, TeamViewer } from "./types";

const roleSchema = z.object({
  name: z.string().trim().min(2, "Give the role a name of at least 2 characters.").max(60, "Keep the name under 60 characters."),
  description: z.string().trim().max(300, "Keep the description under 300 characters."),
});
type RoleValues = z.infer<typeof roleSchema>;

interface RoleEditorProps {
  /** Null when creating a role. */
  role: RoleView | null;
  viewer: TeamViewer;
  catalogue: Readonly<Record<string, string>>;
  /** Set when the viewer may only look. */
  readOnlyReason?: string | null;
  onDone: () => void;
}

export function RoleEditor({ role, viewer, catalogue, readOnlyReason, onDone }: RoleEditorProps) {
  const groups = useMemo(() => groupPermissions(catalogue), [catalogue]);
  const total = Object.keys(catalogue).length;
  const holds = (permission: string) => viewer.isOwner || viewer.permissions.includes(permission);
  // Saving sends the whole list, and a list with anything the viewer lacks is refused.
  const beyondViewer = role !== null && role.systemKey !== "owner" && !canGrantRole(viewer, role);
  const lockReason = readOnlyReason ?? (beyondViewer ? "This role includes permissions you do not hold yourself, so you cannot change it." : null);
  const readOnly = lockReason !== null;
  const builtIn = role?.isSystem ?? false;

  const [selected, setSelected] = useState<Set<string>>(() => new Set(role?.permissions ?? []));
  const form = useForm<RoleValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: { name: role?.name ?? "", description: role?.description ?? "" },
  });
  const { errors } = form.formState;

  const create = useAction(createRoleAction, { toastError: false, success: (data) => `Role ${data.name} created`, onSuccess: onDone });
  const update = useAction(updateRoleAction, { toastError: false, success: (data) => `Role ${data.name} saved`, onSuccess: onDone });
  const action = role ? update : create;

  function toggle(permission: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(permission);
      else next.delete(permission);
      return next;
    });
  }

  function setGroup(keys: string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const permissions = Object.keys(catalogue).filter((key) => selected.has(key));
    const result = role
      ? await update.run(builtIn ? { roleId: role.id, permissions } : { roleId: role.id, ...values, permissions })
      : await create.run({ ...values, permissions });
    if (!result.ok && result.code === "role_name_taken") form.setError("name", { message: result.error }, { shouldFocus: true });
  });

  const message = (name: keyof RoleValues) => errors[name]?.message ?? firstError(action.fieldErrors, name);
  const permissionsError = firstError(action.fieldErrors, "permissions");
  const formLevel = action.error && !action.fieldErrors && !errors.name ? action.error : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-full flex-col">
      <div className="flex flex-1 flex-col gap-5 p-5 sm:p-6">
        {lockReason ? (
          <p className="alert flex gap-2.5 text-muted-foreground">
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{lockReason}</span>
          </p>
        ) : null}
        <FormError message={formLevel} />

        {readOnly || builtIn ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="leading-relaxed text-muted-foreground">{role?.description || "No description."}</p>
            {builtIn && !readOnly ? <p className="field-hint">Built-in roles keep their name and description; you can change their permissions.</p> : null}
          </div>
        ) : (
          <>
            <Field label="Name" error={message("name")}>
              {(control) => <input {...control} {...form.register("name")} className="input" autoComplete="off" />}
            </Field>
            <Field label="Description" note="optional" error={message("description")}>
              {(control) => <textarea {...control} {...form.register("description")} className="textarea" rows={2} />}
            </Field>
          </>
        )}

        <div className="flex flex-col gap-1">
          <p className="label">Permissions</p>
          <p className="text-[13px] text-muted-foreground" aria-live="polite">
            {permissionCount(role?.systemKey === "owner" ? total : selected.size, total)} selected
          </p>
          {permissionsError ? (
            <p role="alert" className="field-error">
              {permissionsError}
            </p>
          ) : null}
        </div>

        {groups.map((group) => {
          const grantable = group.items.filter((item) => holds(item.key)).map((item) => item.key);
          const allOn = grantable.length > 0 && grantable.every((key) => selected.has(key));
          return (
            <fieldset key={group.id} className="flex flex-col gap-1 rounded-lg border p-4" disabled={readOnly}>
              <legend className="px-1 text-sm font-semibold">{group.label}</legend>
              {!readOnly && grantable.length > 1 ? (
                <button type="button" className="btn btn-link btn-sm -mt-1 self-end px-0" onClick={() => setGroup(grantable, !allOn)}>
                  {allOn ? "Clear all" : "Select all"}
                </button>
              ) : null}
              {group.items.map((item) => {
                const held = holds(item.key);
                const id = `perm-${item.key.replace(".", "-")}`;
                return (
                  <div key={item.key} className="flex items-start gap-3 py-1.5">
                    <input
                      id={id}
                      type="checkbox"
                      className="checkbox mt-0.5"
                      checked={role?.systemKey === "owner" || selected.has(item.key)}
                      disabled={readOnly || !held}
                      aria-describedby={!held && !readOnly ? `${id}-note` : undefined}
                      onChange={(event) => toggle(item.key, event.target.checked)}
                    />
                    <label htmlFor={id} className="flex min-w-0 flex-col text-sm leading-snug">
                      <span className={held || readOnly ? undefined : "text-muted-foreground"}>{item.description}</span>
                      {!held && !readOnly ? (
                        <span id={`${id}-note`} className="text-xs text-muted-foreground">
                          You do not hold this permission, so you cannot grant it.
                        </span>
                      ) : null}
                    </label>
                  </div>
                );
              })}
            </fieldset>
          );
        })}
      </div>

      <div className="safe-b sticky bottom-0 flex flex-wrap gap-2 border-t bg-background px-5 pt-4 sm:px-6">
        {readOnly ? (
          <button type="button" className="btn btn-outline mb-4" onClick={onDone}>
            Close
          </button>
        ) : (
          <>
            <SubmitButton pending={action.pending} pendingLabel="Saving…" className="mb-4">
              {role ? "Save role" : "Create role"}
            </SubmitButton>
            <button type="button" className="btn btn-outline mb-4" onClick={onDone} disabled={action.pending}>
              Cancel
            </button>
          </>
        )}
      </div>
    </form>
  );
}
