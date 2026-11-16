"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import { deleteInquiry, INQUIRY_STATUSES, markInquiryRead, setInquiryStatus } from "@/server/content/inquiries";

// The service answers "not found" for anything that is not one of this
// workspace's enquiries, so the id only needs to be a plausible string here.
const idSchema = z.object({ id: z.string().min(1).max(64) });

/** The sidebar badge counts new enquiries and the overview lists them, so the whole shell refreshes. */
function refresh(): void {
  revalidatePath("/workspace", "layout");
}

/** Opening a new enquiry marks it read. */
export const markInquiryReadAction = workspaceAction("content.manage", idSchema, async ({ scope, input }) => {
  const inquiry = await markInquiryRead(scope, input.id);
  refresh();
  return { id: inquiry.id, status: inquiry.status };
});

/** Archive, move back to the inbox (read) or mark as unread (new). */
export const setInquiryStatusAction = workspaceAction(
  "content.manage",
  idSchema.extend({ status: z.enum(INQUIRY_STATUSES) }),
  async ({ scope, input }) => {
    const inquiry = await setInquiryStatus(scope, input.id, input.status);
    refresh();
    return { id: inquiry.id, status: inquiry.status };
  },
);

export const deleteInquiryAction = workspaceAction("content.manage", idSchema, async ({ scope, input }) => {
  await deleteInquiry(scope, input.id);
  refresh();
  return { id: input.id };
});
