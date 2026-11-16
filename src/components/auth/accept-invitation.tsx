"use client";

import { useState } from "react";
import { acceptInvitationAction } from "@/app/(auth)/actions";
import { FormError } from "@/components/form";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { leaveTo } from "./clear-caches";

/** The one button on the invitation page for the invited, signed-in account. */
export function AcceptInvitationButton({ token, workspaceName }: { token: string; workspaceName: string }) {
  const { run, pending, error } = useAction(acceptInvitationAction, { toastError: false, success: `You joined ${workspaceName}` });
  const [leaving, setLeaving] = useState(false);
  const busy = pending || leaving;

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} className="text-left" />
      <button
        type="button"
        className="btn btn-default btn-lg w-full"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={async () => {
          const result = await run({ token });
          if (!result.ok) return;
          // Joining makes this the active workspace: a workspace switch.
          setLeaving(true);
          await leaveTo(result.data.redirectTo);
        }}
      >
        {busy ? <Spinner /> : null}
        Accept and open workspace
      </button>
    </div>
  );
}
