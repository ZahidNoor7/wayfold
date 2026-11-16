import { and, eq } from "drizzle-orm";
import { parseArgs } from "node:util";
import { listDestinations, updateDestination } from "../../src/server/catalog/destinations";
import { listTours, setTourMedia } from "../../src/server/catalog/tours";
import { closeDatabases } from "../../src/server/db/client";
import { withTenant, type TenantScope } from "../../src/server/db/context";
import { mediaAssets, tenants } from "../../src/server/db/schema";
import { createFolder, listFolders } from "../../src/server/media/folders";
import { createUploadSignature, finalizeUpload, updateMedia } from "../../src/server/media";
import { withPlatform } from "../../src/server/platform/db";
import { getSiteContent, updateSiteContent } from "../../src/server/settings/site-content";

/**
 * Adds openly licensed photos from Wikimedia Commons to the Azerbaijan demo
 * business: uploads each one to the business's own Cloudinary account through
 * the normal signed-upload flow, records its description and the credit its
 * licence requires (listed on the website's Photo credits page), then assigns
 * photos to tours, destinations and the home page.
 *
 * Only licences that allow commercial use are accepted (CC0, public domain,
 * CC BY, CC BY-SA); the licence is re-read from Commons at run time and any
 * other licence is refused. Re-running skips photos already uploaded.
 *
 *   pnpm exec tsx --conditions=react-server scripts/demo/azerbaijan-photos.ts [--slug land-of-fire-journeys]
 */
const { values } = parseArgs({ options: { slug: { type: "string", default: "land-of-fire-journeys" } } });
const UA = "WayfoldDemoSeeder/1.0 (open-source tour website demo)";
const ALLOWED = /^(CC0|Public domain|CC BY(-SA)? (2\.0|2\.5|3\.0|4\.0))$/i;

interface Photo {
  key: string;
  title: string;
  alt: string;
}

const PHOTOS: Photo[] = [
  { key: "maiden", title: "File:MAIDEN TOWER BAKU DAYTIME.מגדל העלמה באקו ביום.jpg", alt: "The Maiden Tower in Baku's Old City" },
  { key: "skyline", title: "File:Baku Skyline qiz qalasi.jpg", alt: "Rooftops of Baku's Old City with the Flame Towers behind" },
  { key: "oldStreet", title: "File:Street of Icheri Sheher.jpg", alt: "A street in Icherisheher, Baku's Old City" },
  { key: "shirvanshah", title: "File:Fountain in Palace of the Shirvanshahs.jpg", alt: "Fountain in the grounds of the Palace of the Shirvanshahs, Baku" },
  { key: "petroglyphs", title: "File:Petroglyphs in Gobustan 09.jpg", alt: "Rock engravings at Gobustan" },
  { key: "gobustanRocks", title: "File:Gobustan Petroglyphs Qobustan qoruğu - panoramio.jpg", alt: "Engraved rocks at the Gobustan reserve" },
  { key: "mudVolcano", title: "File:Gobustan mud volcanoes 02.jpg", alt: "A mud volcano cone near Gobustan" },
  { key: "bibiHeybat", title: "File:Bibi-Heybat Mosque, Baku, Azerbaijan (Мечеть Биби-Эйбат, 2026).jpg", alt: "Bibi-Heybat Mosque on the Caspian shore" },
  { key: "yanarDag", title: "File:Yanar Dag in September 2019 (1).jpg", alt: "Flames burning from the hillside at Yanar Dag" },
  { key: "yanarDagVisitors", title: "File:Yanar Dag in September 2019 (3).jpg", alt: "Visitors walking past the flames of Yanar Dag" },
  { key: "ateshgah", title: "File:Surakhani Ateshgah Temple.jpg", alt: "The central altar of the Ateshgah fire temple in Surakhani" },
  { key: "shamakhiMosque", title: "File:Mezquita del Viernes, Shamakhi, Azerbaiyán, 2016-09-27, DD 22-36 HDR PAN.jpg", alt: "The Juma Mosque of Shamakhi lit up at night" },
  { key: "diriBaba", title: "File:Diri Baba mausoleum 11.jpg", alt: "The Diri Baba mausoleum set into the cliff at Maraza" },
  { key: "lahij", title: "File:Lahic in Azerbaijan.jpg", alt: "A valley near Lahij in the foothills of the Greater Caucasus" },
  { key: "shekiPalace", title: "File:Palace of Shaki Khans(1).jpg", alt: "Painted walls and shebeke windows of the Palace of the Sheki Khans" },
  { key: "kish", title: "File:Kish Albanian church in Shaki in sunlight.jpg", alt: "The church at Kish, near Sheki" },
  { key: "gabalaCable", title: "File:Cable Car, Gabala, Azerbaijan.jpg", alt: "A cable car above the mountains of Gabala" },
  { key: "gabalaMountains", title: "File:Mountains of Gabala, Azerbaijan.jpg", alt: "Forested mountains and a lake in Gabala" },
  { key: "nohur", title: "File:Nohurgöl lake, Azerbaijan.jpg", alt: "Nohur Lake in Gabala" },
  { key: "khinalugStreet", title: "File:Khinalug streets, November 2025.jpg", alt: "Stone houses on a street in Khinalug" },
  { key: "khinalugHouse", title: "File:Khinalug streets, November 2025 (49500).jpg", alt: "A house with a blue wooden balcony in Khinalug" },
  { key: "redSettlement", title: "File:Krasnaya Sloboda from the bridge.jpg", alt: "The Red Settlement seen from across the river at Quba" },
  { key: "hirkan", title: "File:Hirkan National Park (2).jpg", alt: "Misty old-growth forest in Hirkan National Park" },
  { key: "khanbulan", title: "File:Xanbulan lake.jpg", alt: "Khanbulan Lake among the forests near Lankaran" },
  { key: "khanbulanDusk", title: "File:Xanbulan gölü,Lənkaran.jpg", alt: "Khanbulan Lake near Lankaran at dusk" },
  { key: "nizami", title: "File:Nizami Mausoleum, Ganja.jpg", alt: "The Mausoleum of Nizami Ganjavi in Ganja" },
  { key: "goygol", title: "File:Goygol Lake.jpg", alt: "Lake Goygol among forested mountains" },
  { key: "goygolCloud", title: "File:Göygöl lake in Azerbaijan.jpg", alt: "Lake Goygol under a cloudy sky" },
];

/** Tour title → photo keys; the first is the cover. */
const TOUR_PHOTOS: Record<string, string[]> = {
  "Grand Azerbaijan: Caspian to Caucasus": ["skyline", "maiden", "shekiPalace", "khinalugHouse", "yanarDag", "petroglyphs", "nohur"],
  "Baku Old City on Foot": ["maiden", "oldStreet", "shirvanshah", "skyline"],
  "Gobustan Rock Art and Mud Volcanoes": ["gobustanRocks", "petroglyphs", "mudVolcano", "bibiHeybat"],
  "Absheron's Eternal Flames": ["yanarDag", "yanarDagVisitors", "ateshgah"],
  "Shamakhi and Lahij: Mosques, Wine and Copper": ["shamakhiMosque", "diriBaba", "lahij"],
  "Silk Road to Sheki": ["shekiPalace", "kish"],
  "Khinalug: Village Above the Clouds": ["khinalugHouse", "khinalugStreet", "redSettlement"],
  "Gabala Mountains and Nohur Lake": ["gabalaMountains", "nohur", "gabalaCable"],
  "Lankaran: Tea Gardens and the Hyrcanian Forest": ["hirkan", "khanbulan", "khanbulanDusk"],
  "Ganja and Lake Goygol": ["goygol", "nizami", "goygolCloud"],
};

/** Destination name → cover photo key. */
const DESTINATION_COVERS: Record<string, string> = {
  "Baku & the Old City": "skyline",
  "Absheron Peninsula": "yanarDag",
  Gobustan: "gobustanRocks",
  "Shamakhi & Lahij": "shamakhiMosque",
  Sheki: "shekiPalace",
  Gabala: "gabalaMountains",
  "Quba & Khinalug": "khinalugHouse",
  Lankaran: "khanbulan",
  "Ganja & Lake Goygol": "goygol",
};

interface CommonsInfo {
  thumb: string;
  license: string;
  artist: string;
  page: string;
}

async function commonsInfo(title: string): Promise<CommonsInfo> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "query", format: "json", titles: title, prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "1800" })) {
    url.searchParams.set(k, v);
  }
  const data = (await (await fetch(url, { headers: { "User-Agent": UA } })).json()) as {
    query?: { pages?: Record<string, { imageinfo?: { thumburl: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }> };
  };
  const info = Object.values(data.query?.pages ?? {})[0]?.imageinfo?.[0];
  if (!info) throw new Error(`Commons has no file called ${title}`);
  const meta = info.extmetadata ?? {};
  const license = meta.LicenseShortName?.value ?? "";
  if (!ALLOWED.test(license)) throw new Error(`${title}: licence "${license}" is not allowed`);
  const artist = (meta.Artist?.value ?? "Unknown").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return { thumb: info.thumburl, license, artist, page: info.descriptionurl };
}

function creditFor(info: CommonsInfo): string {
  const by = info.artist.length > 120 ? `${info.artist.slice(0, 117)}…` : info.artist;
  const licence = /public domain|cc0/i.test(info.license) ? `${info.license} (no rights reserved)` : info.license;
  return `Photo: ${by}, ${licence}, via Wikimedia Commons`;
}

async function uploadPhoto(as: <T>(fn: (scope: TenantScope) => Promise<T>) => Promise<T>, folderId: string, photo: Photo): Promise<string> {
  const filename = `${photo.key}.jpg`;
  const existing = await as(({ tx, tenantId }) =>
    tx.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.tenantId, tenantId), eq(mediaAssets.originalFilename, filename))).limit(1),
  );
  if (existing[0]) return existing[0].id;

  const info = await commonsInfo(photo.title);
  const response = await fetch(info.thumb, { headers: { "User-Agent": UA } });
  if (!response.ok) throw new Error(`Download failed for ${photo.title}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  // The same three steps the media library's browser upload takes.
  const signature = await as((scope) => createUploadSignature(scope, { resourceType: "image", filename, bytes: bytes.byteLength, contentType: "image/jpeg", folderId }));
  const form = new FormData();
  for (const [key, value] of Object.entries(signature.fields)) form.append(key, String(value));
  form.append("file", new Blob([bytes], { type: "image/jpeg" }), filename);
  const uploaded = await fetch(signature.uploadUrl, { method: "POST", body: form });
  if (!uploaded.ok) throw new Error(`Cloudinary refused ${filename}: HTTP ${uploaded.status}`);

  const asset = await as((scope) => finalizeUpload(scope, { publicId: signature.publicId, resourceType: "image", folderId, alt: photo.alt, filename }));
  await as((scope) => updateMedia(scope, asset.id, { credit: creditFor(info), creditUrl: info.page }));
  return asset.id;
}

async function main(): Promise<void> {
  const [tenant] = await withPlatform((tx) => tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, values.slug!)).limit(1));
  if (!tenant) throw new Error(`No business with the address "${values.slug}".`);
  const as = <T>(fn: (scope: TenantScope) => Promise<T>) => withTenant(tenant.id, fn);

  const folders = await as(listFolders);
  const folder = folders.find((item) => item.name === "Azerbaijan tours") ?? (await as((scope) => createFolder(scope, { name: "Azerbaijan tours" })));

  const ids = new Map<string, string>();
  for (const photo of PHOTOS) {
    ids.set(photo.key, await uploadPhoto(as, folder.id, photo));
    console.log(`Uploaded: ${photo.alt}`);
  }
  const pick = (key: string) => {
    const id = ids.get(key);
    if (!id) throw new Error(`No photo for ${key}`);
    return id;
  };

  await as(async (scope) => {
    const { items } = await listTours(scope, { limit: 100 });
    for (const tour of items) {
      const keys = TOUR_PHOTOS[tour.title];
      if (keys) await setTourMedia(scope, tour.id, keys.map(pick));
    }
    for (const destination of await listDestinations(scope)) {
      const key = DESTINATION_COVERS[destination.name];
      if (key) await updateDestination(scope, destination.id, { coverMediaId: pick(key) });
    }
    const { hero } = await getSiteContent(scope);
    await updateSiteContent(scope, "hero", { ...hero, imageMediaId: pick("skyline") });
  });
  console.log(`Photos assigned to ${Object.keys(TOUR_PHOTOS).length} tours, ${Object.keys(DESTINATION_COVERS).length} destinations and the home page.`);
}

main()
  .catch((error: unknown) => {
    console.error("Photo setup failed:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => closeDatabases());
