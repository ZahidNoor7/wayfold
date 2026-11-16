import { eq } from "drizzle-orm";
import { parseArgs } from "node:util";
import { todayIn } from "../../src/lib/dates";
import { listCategories, ensureDefaultCategories } from "../../src/server/catalog/categories";
import { addDeparture } from "../../src/server/catalog/departures";
import { createDestination } from "../../src/server/catalog/destinations";
import { publishTour } from "../../src/server/catalog/publishing";
import { createTour, replaceItinerary, type CreateTourInput, type ItineraryDayInput } from "../../src/server/catalog/tours";
import { closeDatabases } from "../../src/server/db/client";
import { withTenant } from "../../src/server/db/context";
import { tenants, users } from "../../src/server/db/schema";
import { withPlatform } from "../../src/server/platform/db";
import { provisionTenant } from "../../src/server/platform/provision-tenant";
import { createCampaign } from "../../src/server/promotions/campaigns";
import { updateSiteContent } from "../../src/server/settings/site-content";
import { completeOnboarding, updateBranding, updateWorkspaceProfile } from "../../src/server/settings/workspace";

/**
 * Creates "Land of Fire Journeys", a demonstration tour business with tours
 * to Azerbaijan's best-known places, through the same services and validation
 * the workspace uses. Prices and schedules are illustrative; the descriptions
 * of places are factual. No reviews are created: invented guest reviews would
 * read as genuine on a public website.
 *
 *   pnpm exec tsx scripts/demo/azerbaijan.ts --owner-email you@example.com
 */
const { values } = parseArgs({ options: { "owner-email": { type: "string" }, slug: { type: "string", default: "land-of-fire-journeys" } } });
const ownerEmail = values["owner-email"]?.trim().toLowerCase();
if (!ownerEmail) {
  console.error("Pass --owner-email of an existing, verified user who will own the business.");
  process.exit(2);
}
const SLUG = values.slug!;
const usd = (dollars: number) => Math.round(dollars * 100);

const BAKU_MEETING = {
  meetingPoint: "Gosha Gala Gate (Double Gates) of the Old City, Istiglaliyyat Street, Baku. Look for your guide in front of the gate.",
  meetingLatitude: 40.3663,
  meetingLongitude: 49.8361,
};
const HOTEL_PICKUP = {
  meetingPoint: "Pick-up from your hotel or apartment in central Baku. Exact time confirmed the day before.",
  meetingLatitude: null,
  meetingLongitude: null,
};
const DAY_POLICY = "Free cancellation up to 48 hours before the start time. Within 48 hours, or if you do not show up, the full price is due. If we cancel because of weather or road closures, you choose another date or a full refund.";
const MULTI_DAY_POLICY = "Free cancellation up to 14 days before departure. Between 14 and 3 days before, 50% is due; within 3 days, the full price. Mountain roads close in bad weather: if we have to cancel or reroute, you choose another date, an alternative route of equal value, or a full refund.";

interface DestinationSeed {
  key: string;
  name: string;
  region: string;
  tagline: string;
  description: string;
  latitude: number;
  longitude: number;
}

const DESTINATIONS: DestinationSeed[] = [
  {
    key: "baku",
    name: "Baku & the Old City",
    region: "Absheron",
    tagline: "A walled medieval town inside a Caspian capital.",
    description:
      "Icherisheher, Baku's walled Old City, is a UNESCO World Heritage site together with the Palace of the Shirvanshahs and the Maiden Tower, whose origins are still debated. Around it, the city mixes oil-boom mansions from the early twentieth century, the seaside boulevard and contemporary landmarks such as the Flame Towers and the Heydar Aliyev Center.",
    latitude: 40.3664,
    longitude: 49.8352,
  },
  {
    key: "absheron",
    name: "Absheron Peninsula",
    region: "Absheron",
    tagline: "Where the ground itself burns.",
    description:
      "The peninsula east of Baku is where Azerbaijan earned the name Land of Fire. At Yanar Dag a natural gas seep keeps a hillside burning day and night, and in Surakhani the Ateshgah fire temple, a fortified courtyard built in the seventeenth and eighteenth centuries, was used by Hindu and Zoroastrian worshippers.",
    latitude: 40.5014,
    longitude: 49.8913,
  },
  {
    key: "gobustan",
    name: "Gobustan",
    region: "Baku–Gobustan",
    tagline: "Thousands of rock engravings and bubbling mud volcanoes.",
    description:
      "The Gobustan Rock Art Cultural Landscape, a UNESCO World Heritage site, holds more than 6,000 engravings of people, animals and boats spanning many thousands of years, and a Latin inscription left by a Roman legion. Nearby, Azerbaijan's famous mud volcanoes gurgle cold grey mud across the semi-desert.",
    latitude: 40.1103,
    longitude: 49.3746,
  },
  {
    key: "shamakhi",
    name: "Shamakhi & Lahij",
    region: "Shirvan",
    tagline: "The old Shirvan capital and a village of coppersmiths.",
    description:
      "Shamakhi was the capital of the Shirvanshahs. Its Juma Mosque is among the oldest in the Caucasus, and the hills around it are wine country. Higher up, in the Ismayilli district, Lahij is a stone village with cobbled lanes, known for generations of copper craftsmen.",
    latitude: 40.6303,
    longitude: 48.6414,
  },
  {
    key: "sheki",
    name: "Sheki",
    region: "Shaki-Zagatala",
    tagline: "A Silk Road town at the foot of the Greater Caucasus.",
    description:
      "The Historic Centre of Sheki with the Khan's Palace is a UNESCO World Heritage site. The eighteenth-century palace is famous for its painted walls and shebeke windows of wooden lattice and coloured glass. Sheki is also known for its caravanserais, its halva and, in nearby Kish, an ancient church of Caucasian Albania.",
    latitude: 41.1919,
    longitude: 47.1706,
  },
  {
    key: "gabala",
    name: "Gabala",
    region: "Shaki-Zagatala",
    tagline: "Forested mountains, cable cars and quiet lakes.",
    description:
      "Gabala sits on the site of an ancient capital of Caucasian Albania and is now the country's best-known mountain resort, with cable cars up Tufandag and walks around Nohur Lake.",
    latitude: 40.9814,
    longitude: 47.8458,
  },
  {
    key: "khinalug",
    name: "Quba & Khinalug",
    region: "Guba-Khachmaz",
    tagline: "One of the highest villages in the Caucasus.",
    description:
      "Khinalug sits at about 2,300 metres and has its own language, spoken almost nowhere else. The Cultural Landscape of Khinalig People and the Köç Yolu transhumance route became a UNESCO World Heritage site in 2023. On the way, Quba faces the Red Settlement, one of the few towns in the world with an entirely Jewish population, home to Mountain Jews.",
    latitude: 41.1789,
    longitude: 48.1258,
  },
  {
    key: "lankaran",
    name: "Lankaran",
    region: "Lankaran-Astara",
    tagline: "Subtropical tea gardens by the southern Caspian.",
    description:
      "The far south is green and humid: tea plantations, citrus groves and the old-growth forests of Hirkan National Park, part of the Hyrcanian Forests World Heritage site. Lankaran is known for its fish dishes and for lavangi, a stuffed and baked dish of the region.",
    latitude: 38.7536,
    longitude: 48.8511,
  },
  {
    key: "ganja",
    name: "Ganja & Lake Goygol",
    region: "Ganja-Dashkasan",
    tagline: "Azerbaijan's second city and a lake made by an earthquake.",
    description:
      "Ganja is the birthplace of the twelfth-century poet Nizami Ganjavi, whose mausoleum stands at the edge of the city, and home to the eccentric Bottle House. In the mountains to the south, Lake Goygol formed when an earthquake brought down part of Mount Kapaz in 1139.",
    latitude: 40.6828,
    longitude: 46.3606,
  },
];

interface TourSeed {
  input: Omit<CreateTourInput, "categoryId" | "destinationId"> & { category: string; destination: string };
  itinerary?: ItineraryDayInput[];
  departures?: { startDate: string; capacity: number; startTime?: string }[];
}

const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7];

const TOURS: TourSeed[] = [
  {
    input: {
      title: "Baku Old City on Foot",
      category: "Historical",
      destination: "baku",
      place: "Icherisheher, Baku",
      kind: "day",
      durationDays: 1,
      durationLabel: "3 hours",
      priceAdult: usd(45),
      childPricePercent: 50,
      childMaxAge: 11,
      minGroupSize: 1,
      maxGroupSize: 12,
      schedule: { weekdays: ALL_WEEK, slots: [{ time: "10:00", capacity: 12 }, { time: "15:00", capacity: 12 }] },
      languages: ["en", "ru", "az"],
      summary: "Walk the walled Old City: the Maiden Tower, the Palace of the Shirvanshahs, caravanserais and the lanes between them.",
      description:
        "Icherisheher is the oldest part of Baku and still a lived-in neighbourhood. We enter through the Double Gates and follow the lanes to the Maiden Tower, the Palace of the Shirvanshahs and the old caravanserais, with time in a carpet workshop and a tea house. The walk ends on the seaside boulevard.\n\nThe pace is easy, with stops in the shade and plenty of time for questions about Baku's history, from the Shirvanshahs to the first oil boom.",
      highlights: ["Maiden Tower and its legends", "Palace of the Shirvanshahs", "Multani and Bukhara caravanserais", "A carpet workshop and a glass of tea"],
      inclusions: ["Licensed local guide", "Entrance to the Palace of the Shirvanshahs", "Tea and a sweet at a tea house"],
      exclusions: ["Entrance to the Maiden Tower viewing platform", "Gratuities"],
      goodToKnow: ["Comfortable shoes: the lanes are cobbled and uneven.", "Mosques are visited from outside unless the group wishes to enter; shoulders and knees should then be covered."],
      faq: [{ question: "Is the walk suitable for children?", answer: "Yes. The route is flat and short, and children under 12 pay half price." }],
      ...BAKU_MEETING,
      cancellationPolicy: DAY_POLICY,
      isFeatured: true,
      isPopular: true,
      sortOrder: 1,
    },
  },
  {
    input: {
      title: "Gobustan Rock Art and Mud Volcanoes",
      category: "Historical",
      destination: "gobustan",
      place: "Gobustan, south of Baku",
      kind: "day",
      durationDays: 1,
      durationLabel: "6 hours",
      priceAdult: usd(75),
      childPricePercent: 50,
      childMaxAge: 11,
      minGroupSize: 1,
      maxGroupSize: 10,
      schedule: { weekdays: ALL_WEEK, slots: [{ time: "09:30", capacity: 10 }] },
      languages: ["en", "ru"],
      summary: "Ancient petroglyphs at a UNESCO site, then the cold, bubbling mud volcanoes of the semi-desert, with a stop at the Bibi-Heybat Mosque.",
      description:
        "We leave Baku along the Caspian coast, stopping at the Bibi-Heybat Mosque, rebuilt in the 1990s on the site of a medieval mosque destroyed in 1936. At the Gobustan reserve the museum introduces the site before we walk among the rocks to see engravings of hunters, dancers, animals and reed boats.\n\nAfter lunch, local drivers take us by off-road car to the mud volcanoes, where cold mud bubbles up from deep underground.",
      highlights: ["More than 6,000 rock engravings", "Gobustan museum", "Mud volcanoes by off-road car", "Bibi-Heybat Mosque on the Caspian shore"],
      inclusions: ["Licensed guide", "Transport in an air-conditioned vehicle", "Gobustan entrance fee", "Off-road transfer to the mud volcanoes", "Bottled water"],
      exclusions: ["Lunch", "Gratuities"],
      goodToKnow: ["The mud volcano area is muddy after rain: bring shoes you do not mind getting dirty.", "There is little shade at Gobustan; bring a hat in summer."],
      faq: [{ question: "Are the mud volcanoes hot?", answer: "No. The mud is cold: the bubbles are gas, not heat." }],
      ...HOTEL_PICKUP,
      cancellationPolicy: DAY_POLICY,
      isFeatured: true,
      isPopular: true,
      sortOrder: 2,
    },
  },
  {
    input: {
      title: "Absheron's Eternal Flames",
      category: "Cultural",
      destination: "absheron",
      place: "Surakhani and Yanar Dag, Absheron",
      kind: "day",
      durationDays: 1,
      durationLabel: "4 hours",
      priceAdult: usd(55),
      childPricePercent: 50,
      childMaxAge: 11,
      minGroupSize: 1,
      maxGroupSize: 12,
      schedule: { weekdays: ALL_WEEK, slots: [{ time: "15:30", capacity: 12 }] },
      languages: ["en", "ru"],
      summary: "The Ateshgah fire temple and the burning hillside of Yanar Dag, timed to see the flames at dusk.",
      description:
        "An afternoon on the Absheron Peninsula, where natural gas reaches the surface. At the Ateshgah of Surakhani, a fortified fire temple used by Hindu and Zoroastrian worshippers, the guide explains the history of fire worship and the merchants who carried it along the trade routes.\n\nWe reach Yanar Dag in the late afternoon. The hillside has burnt continuously for as long as anyone remembers, and the flames are at their most striking as the light fades.",
      highlights: ["Ateshgah fire temple", "Yanar Dag burning hillside at dusk", "The story of Baku's oil and gas"],
      inclusions: ["Licensed guide", "Transport", "Entrance to Ateshgah and Yanar Dag"],
      exclusions: ["Dinner", "Gratuities"],
      goodToKnow: ["The start time moves with sunset: we confirm it the day before."],
      faq: [],
      ...HOTEL_PICKUP,
      cancellationPolicy: DAY_POLICY,
      isFeatured: false,
      isPopular: true,
      sortOrder: 3,
    },
  },
  {
    input: {
      title: "Shamakhi and Lahij: Mosques, Wine and Copper",
      category: "Food & Local",
      destination: "shamakhi",
      place: "Shamakhi and Lahij, Shirvan",
      kind: "day",
      durationDays: 1,
      durationLabel: "11 hours",
      priceAdult: usd(120),
      childPricePercent: 50,
      childMaxAge: 11,
      minGroupSize: 2,
      maxGroupSize: 8,
      schedule: { weekdays: [2, 4, 6], slots: [{ time: "08:00", capacity: 8 }] },
      languages: ["en", "ru"],
      summary: "A full day west of Baku: the Diri Baba mausoleum, Shamakhi's Juma Mosque, a winery lunch and the coppersmiths of Lahij.",
      description:
        "We drive into the foothills of the Greater Caucasus, stopping at the Diri Baba mausoleum, built into a cliff face at Maraza in the fifteenth century. In Shamakhi we visit the Juma Mosque and the royal tombs of Yeddi Gumbaz before lunch and a tasting at a local winery.\n\nIn the afternoon the road climbs to Lahij, a stone village where coppersmiths still hammer pots and trays in open workshops along the main street.",
      highlights: ["Diri Baba mausoleum in the cliff", "Juma Mosque of Shamakhi", "Lunch and wine tasting at a winery", "Coppersmiths' workshops in Lahij"],
      inclusions: ["Licensed guide", "Transport", "Lunch", "Wine tasting", "Entrance fees"],
      exclusions: ["Purchases in Lahij", "Gratuities"],
      goodToKnow: ["The last part of the road to Lahij is narrow and winding.", "Guests under 18 are served non-alcoholic drinks at the winery."],
      faq: [],
      ...HOTEL_PICKUP,
      cancellationPolicy: DAY_POLICY,
      isFeatured: false,
      isPopular: false,
      sortOrder: 4,
    },
  },
  {
    input: {
      title: "Silk Road to Sheki",
      category: "Cultural",
      destination: "sheki",
      place: "Sheki, Greater Caucasus",
      kind: "private",
      durationDays: 2,
      durationLabel: "2 days, 1 night",
      priceAdult: usd(390),
      childPricePercent: 50,
      childMaxAge: 11,
      minGroupSize: 1,
      maxGroupSize: 8,
      schedule: { weekdays: ALL_WEEK, slots: [] },
      languages: ["en", "ru", "az"],
      summary: "Two days for your group alone: the painted Palace of the Sheki Khans, a night in an old caravanserai town and the church at Kish.",
      description:
        "A private journey along the old trade road to Sheki. The first day crosses Shirvan with stops at Shamakhi, then reaches Sheki in time to wander the old town and its caravanserais.\n\nThe second day starts at the Palace of the Sheki Khans, whose walls are covered in paintings and whose windows are made of thousands of pieces of wood and coloured glass, fitted without nails or glue. After a visit to the Albanian church at Kish and a lunch of piti, we return to Baku in the evening.",
      highlights: ["Palace of the Sheki Khans", "Night in Sheki's old town", "Albanian church at Kish", "Sheki halva and piti"],
      inclusions: ["Private guide and vehicle for your group", "One night in a boutique hotel, breakfast included", "Entrance fees", "Lunch on day 2"],
      exclusions: ["Dinner on day 1", "Gratuities"],
      goodToKnow: ["Price is per adult; the vehicle and guide are yours alone.", "Rooms are double or twin; single rooms on request."],
      faq: [{ question: "Can we stay longer in Sheki?", answer: "Yes. Ask when you book and we will extend the trip with Gabala or the villages around Sheki." }],
      ...HOTEL_PICKUP,
      cancellationPolicy: MULTI_DAY_POLICY,
      isFeatured: true,
      isPopular: true,
      sortOrder: 5,
    },
    itinerary: [
      { dayNumber: 1, title: "Baku to Sheki through Shirvan", location: "Shamakhi, Sheki", description: "Morning departure from Baku. Stops at the Diri Baba mausoleum and the Juma Mosque of Shamakhi. Afternoon arrival in Sheki and an evening walk through the old town.", meta: "About 5 hours of driving" },
      { dayNumber: 2, title: "Khan's Palace and Kish", location: "Sheki, Kish", description: "Morning at the Palace of the Sheki Khans and the Upper Caravanserai. Short drive to Kish and its ancient church. Lunch, then the drive back to Baku.", meta: "Arrival in Baku in the evening" },
    ],
  },
  {
    input: {
      title: "Khinalug: Village Above the Clouds",
      category: "Adventure",
      destination: "khinalug",
      place: "Quba and Khinalug",
      kind: "departure",
      durationDays: 2,
      durationLabel: "2 days, 1 night",
      priceAdult: usd(340),
      childPricePercent: 50,
      childMaxAge: 11,
      minGroupSize: 1,
      maxGroupSize: 10,
      schedule: { weekdays: ALL_WEEK, slots: [] },
      languages: ["en", "ru"],
      summary: "A small-group journey to one of the highest villages in the Caucasus, with a night in a family guesthouse and the Red Settlement on the way.",
      description:
        "We head north to Quba and cross the river to the Red Settlement, home to a community of Mountain Jews. The road then follows the Gudyalchay canyon up to Khinalug, at about 2,300 metres, where houses are stacked against the slope and people speak a language of their own.\n\nThe night is spent in a village guesthouse with a home-cooked dinner. Next morning we walk above the village before returning to Baku.",
      highlights: ["Khinalug, a UNESCO World Heritage cultural landscape", "Gudyalchay canyon road", "Red Settlement near Quba", "Night with a village family"],
      inclusions: ["Guide and transport", "One night in a family guesthouse with dinner and breakfast", "Lunch on both days"],
      exclusions: ["Gratuities"],
      goodToKnow: ["Departures run from late spring to early autumn, when the road is reliably open.", "Guesthouse facilities are simple and rooms may be shared.", "Bring warm layers: evenings are cold even in summer."],
      faq: [{ question: "Is altitude a problem?", answer: "Khinalug is at about 2,300 metres. Most people feel fine; the walk is optional and gentle." }],
      ...HOTEL_PICKUP,
      cancellationPolicy: MULTI_DAY_POLICY,
      isFeatured: false,
      isPopular: true,
      sortOrder: 6,
    },
    itinerary: [
      { dayNumber: 1, title: "Quba, the Red Settlement and the climb to Khinalug", location: "Quba, Khinalug", description: "Drive north to Quba and visit the Red Settlement. Afternoon drive up the Gudyalchay canyon to Khinalug. Dinner with the guesthouse family.", meta: "About 4 hours of driving" },
      { dayNumber: 2, title: "Khinalug morning and return", location: "Khinalug, Baku", description: "Morning walk above the village and a visit to the small local museum. Return to Baku via Quba.", meta: "Arrival in Baku in the late afternoon" },
    ],
    departures: [
      { startDate: "2027-05-15", capacity: 10 },
      { startDate: "2027-06-12", capacity: 10 },
      { startDate: "2027-07-10", capacity: 10 },
      { startDate: "2027-08-14", capacity: 10 },
      { startDate: "2027-09-11", capacity: 10 },
    ],
  },
  {
    input: {
      title: "Gabala Mountains and Nohur Lake",
      category: "Adventure",
      destination: "gabala",
      place: "Gabala",
      kind: "private",
      durationDays: 1,
      durationLabel: "12 hours",
      priceAdult: usd(150),
      childPricePercent: 50,
      childMaxAge: 11,
      minGroupSize: 1,
      maxGroupSize: 8,
      schedule: { weekdays: ALL_WEEK, slots: [] },
      languages: ["en", "ru"],
      summary: "A private day trip to the forests of Gabala: the Tufandag cable car, a walk around Nohur Lake and a waterfall stop.",
      description:
        "A long but easy day in the mountains. We ride the Tufandag cable car for views over the Greater Caucasus, walk around Nohur Lake and stop at a forest waterfall before lunch by a mountain river. The return leg passes through Ismayilli and its orchards.",
      highlights: ["Tufandag cable car", "Nohur Lake", "Lunch by a mountain river"],
      inclusions: ["Private guide and vehicle", "Lunch"],
      exclusions: ["Cable car tickets (paid on the day)", "Gratuities"],
      goodToKnow: ["The cable car does not run in strong wind; we then add a forest walk instead."],
      faq: [],
      ...HOTEL_PICKUP,
      cancellationPolicy: DAY_POLICY,
      isFeatured: false,
      isPopular: false,
      sortOrder: 7,
    },
  },
  {
    input: {
      title: "Lankaran: Tea Gardens and the Hyrcanian Forest",
      category: "Food & Local",
      destination: "lankaran",
      place: "Lankaran and Hirkan National Park",
      kind: "private",
      durationDays: 2,
      durationLabel: "2 days, 1 night",
      priceAdult: usd(360),
      childPricePercent: 50,
      childMaxAge: 11,
      minGroupSize: 1,
      maxGroupSize: 8,
      schedule: { weekdays: ALL_WEEK, slots: [] },
      languages: ["en", "ru"],
      summary: "The green south: tea plantations, a walk in the ancient Hyrcanian forest and a dinner of southern Azerbaijani cooking.",
      description:
        "We drive south along the Caspian to Lankaran, where the climate turns subtropical. The first afternoon is spent at a tea plantation, with a tasting of local black tea, and the evening at a family table with lavangi, the region's stuffed baked dish.\n\nOn the second day we walk in Hirkan National Park, among old-growth trees such as the Persian ironwood, before returning to Baku.",
      highlights: ["Tea plantation visit and tasting", "Hirkan National Park walk", "Southern cooking: lavangi"],
      inclusions: ["Private guide and vehicle", "One night in a hotel with breakfast", "Dinner on day 1", "Park entrance"],
      exclusions: ["Lunch", "Gratuities"],
      goodToKnow: ["The forest is humid and paths can be muddy: wear walking shoes."],
      faq: [],
      ...HOTEL_PICKUP,
      cancellationPolicy: MULTI_DAY_POLICY,
      isFeatured: false,
      isPopular: false,
      sortOrder: 8,
    },
    itinerary: [
      { dayNumber: 1, title: "South along the Caspian", location: "Lankaran", description: "Drive to Lankaran. Afternoon at a tea plantation; dinner with southern dishes.", meta: "About 4 hours of driving" },
      { dayNumber: 2, title: "Hirkan National Park", location: "Hirkan, Baku", description: "Morning forest walk in Hirkan National Park, then return to Baku.", meta: "Arrival in Baku in the evening" },
    ],
  },
  {
    input: {
      title: "Ganja and Lake Goygol",
      category: "Historical",
      destination: "ganja",
      place: "Ganja and Goygol National Park",
      kind: "private",
      durationDays: 2,
      durationLabel: "2 days, 1 night",
      priceAdult: usd(380),
      childPricePercent: 50,
      childMaxAge: 11,
      minGroupSize: 1,
      maxGroupSize: 8,
      schedule: { weekdays: ALL_WEEK, slots: [] },
      languages: ["en", "ru"],
      summary: "Azerbaijan's second city and the mountain lake that an earthquake made: Nizami's mausoleum, the Bottle House and Lake Goygol.",
      description:
        "Ganja is the city of the poet Nizami Ganjavi. We visit his mausoleum, the Juma Mosque and the Bottle House, a home decorated with tens of thousands of glass bottles. Next day we drive into Goygol National Park to the lake that formed when an earthquake brought down part of Mount Kapaz in 1139.",
      highlights: ["Mausoleum of Nizami Ganjavi", "The Bottle House", "Lake Goygol"],
      inclusions: ["Private guide and vehicle", "One night in a hotel with breakfast", "Park entrance"],
      exclusions: ["Meals other than breakfast", "Gratuities"],
      goodToKnow: ["Ganja is about five hours by road from Baku; we can arrange the train instead on request."],
      faq: [],
      ...HOTEL_PICKUP,
      cancellationPolicy: MULTI_DAY_POLICY,
      isFeatured: false,
      isPopular: false,
      sortOrder: 9,
    },
    itinerary: [
      { dayNumber: 1, title: "Baku to Ganja", location: "Ganja", description: "Drive west to Ganja. Afternoon in the city: Nizami's mausoleum, the Juma Mosque and the Bottle House.", meta: "About 5 hours of driving" },
      { dayNumber: 2, title: "Lake Goygol and return", location: "Goygol, Baku", description: "Morning in Goygol National Park and a walk by the lake, then the drive back to Baku.", meta: "Arrival in Baku in the evening" },
    ],
  },
  {
    input: {
      title: "Grand Azerbaijan: Caspian to Caucasus",
      category: "Cultural",
      destination: "baku",
      place: "Baku, Gobustan, Shamakhi, Sheki, Gabala, Quba and Khinalug",
      kind: "departure",
      durationDays: 8,
      durationLabel: "8 days, 7 nights",
      priceAdult: usd(1650),
      childPricePercent: 70,
      childMaxAge: 11,
      minGroupSize: 1,
      maxGroupSize: 12,
      schedule: { weekdays: ALL_WEEK, slots: [] },
      languages: ["en"],
      summary: "Eight days through the country's best-known places, from Baku's Old City and Gobustan to Sheki, Gabala and the mountain village of Khinalug.",
      description:
        "Our most complete journey, in a small group. It begins in Baku with the Old City, the Absheron fire sites and Gobustan, then crosses Shirvan to Sheki and the forests of Gabala before turning north to Quba and Khinalug. Nights are in characterful small hotels and one village guesthouse.",
      highlights: ["Three UNESCO World Heritage sites and a fourth in Khinalug", "Palace of the Sheki Khans", "Night in Khinalug", "Yanar Dag at dusk"],
      inclusions: ["Guide throughout", "All transport", "Seven nights' accommodation with breakfast", "Five lunches and two dinners", "Entrance fees"],
      exclusions: ["International flights and visa", "Travel insurance", "Gratuities"],
      goodToKnow: ["Most visitors need an e-visa, applied for online in advance.", "Single rooms are available for a supplement."],
      faq: [{ question: "How fit do I need to be?", answer: "Walking is easy to moderate. The longest walk, above Khinalug, is optional." }],
      meetingPoint: "Your hotel in Baku on the morning of day 1. Airport transfers can be added when you book.",
      meetingLatitude: null,
      meetingLongitude: null,
      cancellationPolicy: MULTI_DAY_POLICY,
      isFeatured: true,
      isPopular: true,
      sortOrder: 0,
    },
    itinerary: [
      { dayNumber: 1, title: "Baku's Old City", location: "Baku", description: "Walking tour of Icherisheher: the Maiden Tower and the Palace of the Shirvanshahs. Welcome dinner.", meta: "Overnight in Baku" },
      { dayNumber: 2, title: "Gobustan and the mud volcanoes", location: "Gobustan", description: "Rock engravings at Gobustan, the mud volcanoes and the Bibi-Heybat Mosque.", meta: "Overnight in Baku" },
      { dayNumber: 3, title: "Land of Fire", location: "Absheron", description: "Ateshgah fire temple, the modern city and Yanar Dag at dusk.", meta: "Overnight in Baku" },
      { dayNumber: 4, title: "Across Shirvan to Sheki", location: "Shamakhi, Sheki", description: "Diri Baba mausoleum, Shamakhi's Juma Mosque and a winery lunch on the way to Sheki.", meta: "Overnight in Sheki" },
      { dayNumber: 5, title: "Sheki and Kish", location: "Sheki", description: "Palace of the Sheki Khans, the caravanserais and the church at Kish.", meta: "Overnight in Sheki" },
      { dayNumber: 6, title: "Gabala's mountains", location: "Gabala", description: "Tufandag cable car and Nohur Lake, then on towards Quba.", meta: "Overnight in Quba" },
      { dayNumber: 7, title: "Khinalug", location: "Khinalug", description: "Red Settlement, the Gudyalchay canyon and an afternoon in Khinalug.", meta: "Overnight in a village guesthouse" },
      { dayNumber: 8, title: "Return to Baku", location: "Baku", description: "Morning walk above Khinalug and the drive back to Baku.", meta: "Tour ends in the afternoon" },
    ],
    departures: [
      { startDate: "2027-05-08", capacity: 12 },
      { startDate: "2027-06-05", capacity: 12 },
      { startDate: "2027-09-04", capacity: 12 },
      { startDate: "2027-10-02", capacity: 12 },
    ],
  },
];

async function main(): Promise<void> {
  const [owner] = await withPlatform((tx) =>
    tx.select({ id: users.id, verified: users.emailVerifiedAt }).from(users).where(eq(users.email, ownerEmail!)).limit(1),
  );
  if (!owner?.verified) throw new Error("No verified user with that e-mail. Create the account first.");
  const [existing] = await withPlatform((tx) => tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, SLUG)).limit(1));
  if (existing) throw new Error(`A business with the address "${SLUG}" already exists. Nothing was changed.`);

  const { tenantId } = await provisionTenant({ name: "Land of Fire Journeys", slug: SLUG, ownerUserId: owner.id, planCode: "business" });
  const as = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(tenantId, fn, { userId: owner.id });
  const today = todayIn("Asia/Baku");

  await as(async (scope) => {
    await updateWorkspaceProfile(scope, {
      tagline: "Small-group and private journeys across Azerbaijan",
      description:
        "Land of Fire Journeys runs walking tours in Baku, day trips to Gobustan and the Absheron fire sites, and longer journeys to Sheki, Gabala, Khinalug, Lankaran and Ganja, in small groups or privately.",
      email: ownerEmail!,
      address: "Baku, Azerbaijan",
      regions: ["Absheron", "Shirvan", "Shaki-Zagatala", "Guba-Khachmaz", "Lankaran-Astara", "Ganja-Dashkasan"],
      languages: ["en", "az", "ru"],
      currency: "USD",
      timezone: "Asia/Baku",
    });
    await updateBranding(scope, { theme: "emerald", mode: "light", radius: "md", font: "classic" });
  });
  console.log("Business created: Land of Fire Journeys");

  const destinationIds = new Map<string, string>();
  await as(async (scope) => {
    for (const [index, destination] of DESTINATIONS.entries()) {
      const { key, ...fields } = destination;
      const created = await createDestination(scope, { ...fields, isPublished: true, sortOrder: index });
      destinationIds.set(key, created.id);
    }
  });
  console.log(`Destinations: ${destinationIds.size}`);

  const categoryIds = new Map<string, string>();
  await as(async (scope) => {
    await ensureDefaultCategories(scope);
    for (const category of await listCategories(scope)) categoryIds.set(category.name, category.id);
  });

  const tourIds = new Map<string, string>();
  for (const seed of TOURS) {
    const { category, destination, ...input } = seed.input;
    const id = await as(async (scope) => {
      const tour = await createTour(scope, { ...input, categoryId: categoryIds.get(category) ?? null, destinationId: destinationIds.get(destination) ?? null });
      if (seed.itinerary) await replaceItinerary(scope, tour.id, seed.itinerary);
      for (const departure of seed.departures ?? []) await addDeparture(scope, tour.id, departure, { today });
      await publishTour(scope, tour.id, { today });
      return tour.id;
    });
    tourIds.set(seed.input.title, id);
    console.log(`Published: ${seed.input.title}`);
  }

  await as(async (scope) => {
    await updateSiteContent(scope, "hero", {
      kicker: "Private and small-group journeys in Azerbaijan",
      headline: "Discover the Land of Fire",
      headlineEmphasis: "through local eyes.",
      body: "From Baku's walled Old City and the rock art of Gobustan to Silk Road Sheki and the mountain village of Khinalug: unhurried journeys with guides who live here.",
      nowGuiding: "Sheki, Greater Caucasus",
    });
    await updateSiteContent(scope, "stats", [
      { label: "UNESCO World Heritage sites in Azerbaijan", value: "5" },
      { label: "Journeys to choose from", value: String(TOURS.length) },
      { label: "Destinations", value: String(DESTINATIONS.length) },
    ]);
    await updateSiteContent(scope, "valueProps", [
      { title: "Small groups", text: "Group tours are capped at twelve, and most of our longer journeys can be booked privately.", icon: "users" },
      { title: "Local guides", text: "Every tour is led by a guide who lives in Azerbaijan and speaks your language.", icon: "compass" },
      { title: "Unhurried pace", text: "Time to sit with a glass of tea, talk to craftsmen and see places at their best light.", icon: "clock" },
      { title: "Flexible dates", text: "Private tours run on any open date; group departures are listed months ahead.", icon: "calendar" },
    ]);
    await updateSiteContent(scope, "about", {
      credentialLine: "Tour operator based in Baku",
      shortBio: "We are a small team of Baku-based guides running walking tours, day trips and multi-day journeys across Azerbaijan.",
      longBio:
        "Land of Fire Journeys started with walking tours of Baku's Old City and grew into journeys across the country: the fire sites of Absheron, the rock art of Gobustan, the Silk Road towns of the north-west, the mountain villages of the Greater Caucasus and the green south around Lankaran.\n\nWe keep groups small, plan each day around the places rather than the clock, and are happy to build private itineraries around your interests.",
      philosophyQuote: "Travel slowly, listen to the people who live there, and the country will tell you its own story.",
    });
    await updateSiteContent(scope, "languages", [
      { name: "English", level: "Fluent", percent: 95 },
      { name: "Azerbaijani", level: "Native", percent: 100 },
      { name: "Russian", level: "Fluent", percent: 90 },
    ]);
    await updateSiteContent(scope, "faq", [
      { question: "Do I need a visa?", answer: "Most visitors need an e-visa, which is applied for online through Azerbaijan's official ASAN Visa portal before travel. Check the requirements for your nationality before booking flights." },
      { question: "What is the local currency?", answer: "The Azerbaijani manat (AZN). Cards are widely accepted in Baku; carry some cash for villages and markets." },
      { question: "When is the best time to visit?", answer: "Late spring and early autumn are mild and ideal for travel everywhere. Summer is hot in Baku but pleasant in the mountains; some mountain roads can close in winter." },
      { question: "Is there a dress code for religious sites?", answer: "In mosques, shoulders and knees should be covered and women are asked to cover their hair. Scarves are usually available at the entrance." },
      { question: "How do I pay?", answer: "Send a booking request first. Once we confirm your date, we explain how to pay; nothing is charged when you send the request." },
    ]);
    await updateSiteContent(scope, "contact", {
      hours: "Monday to Saturday, 9:00–19:00 (Baku time)",
      responseTime: "We reply to every request within one working day.",
      mapLatitude: 40.3664,
      mapLongitude: 49.8352,
      serviceLocations: DESTINATIONS.map((destination) => destination.name),
    });
    await updateSiteContent(scope, "seo", {
      home: { title: "Land of Fire Journeys: tours in Azerbaijan", description: "Small-group and private tours across Azerbaijan: Baku's Old City, Gobustan, the Absheron fire sites, Sheki, Gabala, Khinalug, Lankaran and Ganja." },
      experiences: { title: "Tours and day trips in Azerbaijan", description: "Walking tours in Baku, day trips to Gobustan and Yanar Dag, and multi-day journeys to Sheki, Khinalug and beyond." },
    });
    await updateSiteContent(scope, "footer", {
      blurb: "Small-group and private journeys across Azerbaijan, from the Caspian shore to the villages of the Greater Caucasus.",
    });
    await updateSiteContent(scope, "featured", { mode: "manual" });

    const flames = tourIds.get("Absheron's Eternal Flames");
    if (flames) {
      await createCampaign(
        scope,
        {
          name: "Winter evenings by the fire",
          blurb: "15% off Absheron's Eternal Flames this winter, when the flames of Yanar Dag look their brightest against the early dusk.",
          type: "percent",
          value: 15,
          appliesToAllTours: false,
          tourIds: [flames],
          startsOn: today,
          endsOn: "2027-02-28",
        },
        today,
      );
    }
    await createCampaign(
      scope,
      {
        name: "Plan ahead for spring",
        blurb: "10% off any tour booked at least 60 days before your travel date.",
        type: "percent",
        value: 10,
        appliesToAllTours: true,
        bookAheadDays: 60,
        startsOn: today,
        endsOn: "2027-04-30",
      },
      today,
    );
    await completeOnboarding(scope);
  });
  console.log("Website content, two offers and onboarding complete.");
}

main()
  .catch((error: unknown) => {
    console.error("Demo setup failed:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => closeDatabases());
