import { and, eq } from "drizzle-orm";
import { listReviews, updateReview } from "../../src/server/content/reviews";
import { closeDatabases } from "../../src/server/db/client";
import { withTenant } from "../../src/server/db/context";
import { mediaAssets, tenants } from "../../src/server/db/schema";
import { withPlatform } from "../../src/server/platform/db";

/**
 * Attaches photos from the media library to a few of the fictional "Land of
 * Fire Journeys" test reviews, so the review photo strip and viewer can be
 * tried on the demo website. The photos are the library's Wikimedia Commons
 * images (credited on the website's photo credits page), not customer photos.
 * Reviews that already have attachments are left alone.
 */
const SLUG = "land-of-fire-journeys";

/** Reviewer name and the alt texts of the library photos to attach, in order. */
const ATTACH: { customerName: string; alts: string[] }[] = [
  { customerName: "Marco R.", alts: ["The Maiden Tower in Baku's Old City", "A street in Icherisheher, Baku's Old City"] },
  { customerName: "Aiko T.", alts: ["Rock engravings at Gobustan", "A mud volcano cone near Gobustan", "Engraved rocks at the Gobustan reserve"] },
  { customerName: "Daniel K.", alts: ["Flames burning from the hillside at Yanar Dag"] },
];

async function main(): Promise<void> {
  const [tenant] = await withPlatform((tx) => tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, SLUG)).limit(1));
  if (!tenant) throw new Error(`No business with the address "${SLUG}".`);
  const done = await withTenant(tenant.id, async (scope) => {
    const { items } = await listReviews(scope, { limit: 100 });
    const updated: string[] = [];
    for (const { customerName, alts } of ATTACH) {
      const review = items.find((item) => item.customerName === customerName);
      if (!review || review.media.length > 0) continue;
      const mediaIds: string[] = [];
      for (const alt of alts) {
        const [asset] = await scope.tx
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(and(eq(mediaAssets.tenantId, scope.tenantId), eq(mediaAssets.alt, alt)))
          .limit(1);
        if (asset) mediaIds.push(asset.id);
      }
      if (mediaIds.length === 0) continue;
      await updateReview(scope, review.id, { mediaIds });
      updated.push(`${customerName} (${mediaIds.length})`);
    }
    return updated;
  });
  console.log(done.length > 0 ? `Photos attached: ${done.join(", ")}.` : "Nothing to attach; no reviews were changed.");
}

main()
  .catch((error: unknown) => {
    console.error("Attaching review photos failed:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => closeDatabases());
