"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import { addDomain, removeDomain, setPrimaryDomain, verifyDomain } from "@/server/settings/domains";

// Ids are checked by the service: one that cannot name a domain is "not found" there.
const idSchema = z.string().min(1).max(64);

function refresh(): void {
  revalidatePath("/workspace/settings/domains");
  // The storefront builds canonical links from the primary domain.
  revalidatePath("/s/[site]", "layout");
}

export const addDomainAction = workspaceAction("domains.manage", z.object({ domain: z.string().max(300) }), async ({ scope, input }) => {
  const view = await addDomain(scope, input.domain);
  refresh();
  return view;
});

export const verifyDomainAction = workspaceAction("domains.manage", z.object({ id: idSchema }), async ({ scope, input }) => {
  const view = await verifyDomain(scope, input.id);
  refresh();
  return view;
});

export const setPrimaryDomainAction = workspaceAction("domains.manage", z.object({ id: idSchema.nullable() }), async ({ scope, input }) => {
  await setPrimaryDomain(scope, input.id);
  refresh();
  return { id: input.id };
});

export const removeDomainAction = workspaceAction("domains.manage", z.object({ id: idSchema }), async ({ scope, input }) => {
  await removeDomain(scope, input.id);
  refresh();
  return { id: input.id };
});
