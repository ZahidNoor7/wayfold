"use client";

import { useState } from "react";
import { requestPlanChangeAction } from "@/app/workspace/billing/actions";
import { ConfirmDialog } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";

interface RequestPlanChangeProps {
  planCode: string;
  planName: string;
  currentPlanName: string;
}

/**
 * "Request change" for one plan in the comparison. The workspace cannot
 * switch plans itself: the request goes to Wayfold, who make the change.
 */
export function RequestPlanChange({ planCode, planName, currentPlanName }: RequestPlanChangeProps) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const { run, pending, error, reset } = useAction(requestPlanChangeAction, {
    toastError: false,
    success: (data) => `Request sent. Wayfold will be in touch about moving you to ${data.name}.`,
    onSuccess: () => {
      setOpen(false);
      setRequested(true);
    },
  });

  if (requested) {
    return (
      <p role="status" className="text-[13px] font-medium text-[var(--status-confirmed-fg)]">
        Request sent. Wayfold will be in touch to arrange the change.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-outline w-full"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Request change
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Ask to move to ${planName}?`}
        description={
          <>
            <p>
              Plan changes are made by Wayfold. This sends them your request to move from {currentPlanName} to {planName}, and they will be in touch to
              arrange it. Nothing changes until then.
            </p>
            {error ? (
              <p role="alert" className="mt-2 font-medium text-destructive">
                {error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Send request"
        pending={pending}
        onConfirm={() => void run({ planCode })}
      />
    </>
  );
}
