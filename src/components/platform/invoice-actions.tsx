"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { markInvoicePaidAction, voidInvoiceAction } from "@/app/platform/(console)/billing/actions";

interface InvoiceActionsProps {
  invoiceId: string;
  number: string;
  /** Formatted amount, e.g. "$290". */
  amount: string;
  tenantName: string;
}

/** The two things that can happen to an open invoice. Both are final. */
export function InvoiceActions({ invoiceId, number, amount, tenantName }: InvoiceActionsProps) {
  const [confirming, setConfirming] = useState<"paid" | "void" | null>(null);
  const pay = useAction(markInvoicePaidAction, { success: (data) => `Invoice ${data.number} marked paid` });
  const cancel = useAction(voidInvoiceAction, { success: (data) => `Invoice ${data.number} voided` });

  return (
    <span className="flex justify-end gap-2">
      <button type="button" className="btn btn-outline btn-sm" aria-label={`Mark invoice ${number} paid`} onClick={() => setConfirming("paid")}>
        Mark paid
      </button>
      <button type="button" className="btn btn-ghost btn-sm text-destructive" aria-label={`Void invoice ${number}`} onClick={() => setConfirming("void")}>
        Void
      </button>

      <ConfirmDialog
        open={confirming === "paid"}
        onOpenChange={(open) => setConfirming(open ? "paid" : null)}
        title={`Mark ${number} as paid?`}
        description={`Records that ${tenantName} has paid ${amount}. A past-due subscription becomes active again. A paid invoice is a financial record and cannot be voided afterwards.`}
        confirmLabel="Mark paid"
        pending={pay.pending}
        onConfirm={async () => {
          await pay.run({ invoiceId });
          setConfirming(null);
        }}
      />
      <ConfirmDialog
        open={confirming === "void"}
        onOpenChange={(open) => setConfirming(open ? "void" : null)}
        title={`Void ${number}?`}
        description={`Cancels the invoice of ${amount} to ${tenantName}. It stays in the list as void and can no longer be paid. This cannot be undone.`}
        confirmLabel="Void invoice"
        cancelLabel="Keep invoice"
        destructive
        pending={cancel.pending}
        onConfirm={async () => {
          await cancel.run({ invoiceId });
          setConfirming(null);
        }}
      />
    </span>
  );
}
