"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import {
  addCustomerNote,
  customerNoteSchema,
  deleteCustomerNote,
  setMarketingOptIn,
  setPreferredContact,
  updateCustomer,
  updateCustomerSchema,
} from "@/server/customers/service";

// Ids are checked by the services: one that cannot name a record is "not found" there.
const idSchema = z.string().min(1).max(64);

/** The list shows names, e-mails and totals; the profile page shows everything else. */
function refresh(customerId: string): void {
  revalidatePath("/workspace/customers");
  revalidatePath(`/workspace/customers/${customerId}`);
}

export const updateCustomerAction = workspaceAction(
  "customers.manage",
  updateCustomerSchema.pick({ name: true, email: true, phone: true, country: true, language: true }).extend({ id: idSchema }),
  async ({ scope, input }) => {
    const { id, ...patch } = input;
    const customer = await updateCustomer(scope, id, patch);
    refresh(id);
    return { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, country: customer.country, language: customer.language };
  },
);

export const setMarketingOptInAction = workspaceAction(
  "customers.manage",
  z.object({ id: idSchema, optIn: z.boolean() }),
  async ({ scope, input }) => {
    const customer = await setMarketingOptIn(scope, input.id, input.optIn);
    refresh(input.id);
    return { id: customer.id, marketingOptIn: customer.marketingOptIn };
  },
);

export const setPreferredContactAction = workspaceAction(
  "customers.manage",
  z.object({ id: idSchema, method: z.enum(["email", "whatsapp", "phone"]) }),
  async ({ scope, input }) => {
    const customer = await setPreferredContact(scope, input.id, input.method);
    refresh(input.id);
    return { id: customer.id, preferredContact: customer.preferredContact };
  },
);

export const addCustomerNoteAction = workspaceAction(
  "customers.manage",
  customerNoteSchema.extend({ customerId: idSchema }),
  async ({ scope, input }) => {
    const note = await addCustomerNote(scope, input.customerId, input.body);
    refresh(input.customerId);
    return { id: note.id };
  },
);

export const deleteCustomerNoteAction = workspaceAction(
  "customers.manage",
  z.object({ customerId: idSchema, noteId: idSchema }),
  async ({ scope, input }) => {
    await deleteCustomerNote(scope, input.customerId, input.noteId);
    refresh(input.customerId);
    return { id: input.noteId };
  },
);
