"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { platformAction } from "@/server/actions";
import { markInvoicePaid, voidInvoice } from "@/server/platform/billing";
import { toActor } from "../../_lib/guard";

const schema = z.object({ invoiceId: z.uuid() });

export const markInvoicePaidAction = platformAction("owner", schema, async ({ admin, input }) => {
  const invoice = await markInvoicePaid(toActor(admin), input.invoiceId);
  revalidatePath("/platform", "layout");
  return { number: invoice.number };
});

export const voidInvoiceAction = platformAction("owner", schema, async ({ admin, input }) => {
  const invoice = await voidInvoice(toActor(admin), input.invoiceId);
  revalidatePath("/platform", "layout");
  return { number: invoice.number };
});
