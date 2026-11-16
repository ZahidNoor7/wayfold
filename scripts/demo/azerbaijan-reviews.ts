import { eq } from "drizzle-orm";
import { listTours } from "../../src/server/catalog/tours";
import { createReview } from "../../src/server/content/reviews";
import { closeDatabases } from "../../src/server/db/client";
import { withTenant } from "../../src/server/db/context";
import { reviews, tenants } from "../../src/server/db/schema";
import { withPlatform } from "../../src/server/platform/db";

/**
 * Test reviews for the fictional "Land of Fire Journeys" demo business: a
 * mix of published and unpublished reviews across tours and ratings, for
 * exercising the Reviews screen and the storefront. None is marked verified,
 * because "verified" should only ever mean a review tied to a real booking.
 * Skips if the business already has reviews.
 */
const SLUG = "land-of-fire-journeys";

interface Seed {
  tour: string | null;
  customerName: string;
  country: string;
  rating: number;
  title: string;
  body: string;
  reviewedOn: string;
  isPublished: boolean;
  isFeatured?: boolean;
}

const SEEDS: Seed[] = [
  { tour: "Grand Azerbaijan: Caspian to Caucasus", customerName: "Hannah W.", country: "United Kingdom", rating: 5, title: "Eight days that covered everything", body: "We wanted to see as much of the country as possible without rushing, and this did exactly that. The night in Khinalug was the highlight: dinner with the family, then stars like I have never seen. Sheki's palace is even more beautiful in person.", reviewedOn: "2026-10-12", isPublished: true, isFeatured: true },
  { tour: "Baku Old City on Foot", customerName: "Marco R.", country: "Italy", rating: 5, title: "The best way to start a trip to Baku", body: "Three hours went by quickly. Our guide knew every corner of the Old City and the stories behind the Maiden Tower. The tea stop at the end was a lovely touch.", reviewedOn: "2026-10-03", isPublished: true, isFeatured: true },
  { tour: "Gobustan Rock Art and Mud Volcanoes", customerName: "Aiko T.", country: "Japan", rating: 5, title: "Petroglyphs and bubbling mud in one day", body: "I did not expect the rock engravings to be so detailed. The drive out to the mud volcanoes in an old Lada was an adventure in itself. Bring shoes you can get muddy!", reviewedOn: "2026-09-21", isPublished: true, isFeatured: true },
  { tour: "Absheron's Eternal Flames", customerName: "Daniel K.", country: "Germany", rating: 4, title: "Yanar Dag at dusk is worth it", body: "The fire temple was fascinating and well explained. Yanar Dag is smaller than the photos suggest, but seeing it as the light goes is special. A good half-day trip.", reviewedOn: "2026-09-14", isPublished: true },
  { tour: "Silk Road to Sheki", customerName: "Sophie L.", country: "France", rating: 5, title: "A private trip done perfectly", body: "Having our own guide and car meant we could stop wherever we liked. The palace windows are extraordinary, and the halva in Sheki is dangerous. The hotel was charming.", reviewedOn: "2026-08-30", isPublished: true },
  { tour: "Khinalug: Village Above the Clouds", customerName: "James O.", country: "Australia", rating: 5, title: "Unforgettable mountain village", body: "The road up through the canyon is spectacular. The guesthouse was simple but warm and the food was excellent. Walking above the village in the morning was the best part of our trip.", reviewedOn: "2026-08-18", isPublished: true },
  { tour: "Shamakhi and Lahij: Mosques, Wine and Copper", customerName: "Elena P.", country: "Spain", rating: 4, title: "Long day, lots to see", body: "A full day but well paced. The winery lunch was generous and the coppersmiths in Lahij were happy to show us their work. The last part of the road is slow, so expect a late return.", reviewedOn: "2026-07-27", isPublished: true },
  { tour: "Gabala Mountains and Nohur Lake", customerName: "Omar S.", country: "United Arab Emirates", rating: 4, title: "Green, cool and relaxing", body: "A welcome break from the heat of Baku. The cable car views were great and lunch by the river was delicious. Our driver was careful on the mountain roads.", reviewedOn: "2026-07-10", isPublished: true },
  { tour: "Ganja and Lake Goygol", customerName: "Natalia V.", country: "Poland", rating: 5, title: "A side of Azerbaijan few visitors see", body: "Ganja surprised us, and the Bottle House is wonderfully odd. Lake Goygol was calm and beautiful in the early morning. Recommended if you have already seen Baku.", reviewedOn: "2026-06-22", isPublished: true },
  { tour: "Lankaran: Tea Gardens and the Hyrcanian Forest", customerName: "Lucas M.", country: "Netherlands", rating: 4, title: "Tea, forests and great food", body: "The tea plantation visit and the family dinner were the highlights. The forest walk was muddy after rain but atmospheric. A very different landscape from the north.", reviewedOn: "2026-06-05", isPublished: true },
  { tour: null, customerName: "Priya N.", country: "India", rating: 5, title: "Helpful from the first message", body: "They answered all our questions quickly and helped us combine two tours into one longer trip. Everything ran on time and as described.", reviewedOn: "2026-05-19", isPublished: true },
  { tour: "Baku Old City on Foot", customerName: "Thomas B.", country: "United States", rating: 3, title: "Good walk, large group", body: "The guide was knowledgeable, but our group was at the maximum size and it was sometimes hard to hear. The route itself is excellent.", reviewedOn: "2026-10-20", isPublished: false },
  { tour: "Absheron's Eternal Flames", customerName: "Ingrid H.", country: "Norway", rating: 2, title: "Pick-up was late", body: "The sites were interesting, but our pick-up was forty minutes late and we arrived at Yanar Dag after dark. The guide apologised and was friendly.", reviewedOn: "2026-10-26", isPublished: false },
  { tour: "Gobustan Rock Art and Mud Volcanoes", customerName: "Kenji A.", country: "Japan", rating: 5, title: "Excellent day trip", body: "Well organised from start to finish. The museum helped us understand the engravings before we walked among the rocks.", reviewedOn: "2026-11-02", isPublished: false },
  { tour: "Grand Azerbaijan: Caspian to Caucasus", customerName: "Rachel G.", country: "Canada", rating: 4, title: "Great itinerary, long drives", body: "We loved the variety. Some driving days were long, so bring a book. Accommodation was characterful throughout.", reviewedOn: "2026-11-08", isPublished: false },
];

async function main(): Promise<void> {
  const [tenant] = await withPlatform((tx) => tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, SLUG)).limit(1));
  if (!tenant) throw new Error(`No business with the address "${SLUG}".`);
  await withTenant(tenant.id, async (scope) => {
    const existing = await scope.tx.select({ id: reviews.id }).from(reviews).where(eq(reviews.tenantId, scope.tenantId)).limit(1);
    if (existing[0]) throw new Error("This business already has reviews. Nothing was changed.");
    const { items } = await listTours(scope, { limit: 100 });
    const tourId = (title: string | null) => (title ? (items.find((tour) => tour.title === title)?.id ?? null) : null);
    for (const seed of SEEDS) {
      const { tour, isFeatured = false, ...fields } = seed;
      await createReview(scope, { ...fields, tourId: tourId(tour), isFeatured, isVerified: false });
    }
  });
  const published = SEEDS.filter((seed) => seed.isPublished).length;
  console.log(`Reviews added: ${SEEDS.length} (${published} published, ${SEEDS.length - published} unpublished).`);
}

main()
  .catch((error: unknown) => {
    console.error("Review setup failed:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => closeDatabases());
