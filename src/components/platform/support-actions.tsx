"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { startSupportSessionAction } from "@/app/platform/(console)/support/actions";

/**
 * Opens the approved workspace under a view-only support session. On success
 * the action replaces the platform session and redirects; `useAction` treats
 * that as navigation and shows nothing. Only a refusal is shown, in place.
 */
export function EnterWorkspaceButton({ grantId, tenantName }: { grantId: string; tenantName: string }) {
  const [open, setOpen] = useState(false);
  const action = useAction(startSupportSessionAction, { toastError: false });
  const error = action.error || null;

  return (
    <>
      <button type="button" className="btn btn-default btn-sm" onClick={() => setOpen(true)}>
        Enter workspace
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) action.reset();
        }}
        title={`Enter ${tenantName}?`}
        description={
          <div className="flex flex-col gap-2">
            <p>
              You will see the workspace as its team does, but you cannot change anything. A banner tells everyone a Wayfold support session is in progress, and
              the start and end are written to the workspace&apos;s activity log.
            </p>
            <p>Entering signs you out of the platform back office. To come back, end the session from the banner and sign in again.</p>
            {error ? (
              <p role="alert" className="alert alert-destructive">
                {error}
              </p>
            ) : null}
          </div>
        }
        confirmLabel="Enter workspace"
        pending={action.pending}
        onConfirm={() => void action.run({ grantId })}
      />
    </>
  );
}
