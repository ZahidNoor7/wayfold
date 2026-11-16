import { describe, expect, it } from "vitest";
import {
  defaultSiteContent,
  getSiteContent,
  SEO_PAGES,
  SITE_SECTIONS,
  updateSiteContent,
  VALUE_PROP_ICONS,
  type SiteSection,
} from "@/server/settings/site-content";
import { readSiteDocument, writeSiteDocument } from "@/server/settings/tenant-settings";
import { createTenant, randomId } from "../../helpers/fixtures";
import { asOwner, asVisitor, auditActions, failure, seedMedia } from "../content/seed";

const emptyPage = { title: "", description: "" };

describe("site content: reading", () => {
  it("gives a brand-new workspace a complete, empty document", async () => {
    const tenant = await createTenant();
    const content = await asVisitor(tenant)((scope) => getSiteContent(scope));

    expect(content).toEqual({
      hero: { kicker: "", headline: "", headlineEmphasis: "", body: "", imageMediaId: null, nowGuiding: "" },
      stats: [],
      valueProps: [],
      about: { portraitMediaId: null, credentialLine: "", shortBio: "", longBio: "", philosophyQuote: "", licenceLine: "" },
      languages: [],
      skills: [],
      qualifications: [],
      milestones: [],
      faq: [],
      contact: { hours: "", responseTime: "", mapLatitude: null, mapLongitude: null, serviceLocations: [] },
      seo: Object.fromEntries(SEO_PAGES.map((page) => [page, emptyPage])),
      footer: { blurb: "" },
      featured: { mode: "manual" },
      legal: { privacy: "", terms: "" },
    });
    expect(content).toEqual(defaultSiteContent());
    expect(Object.keys(content).sort()).toEqual([...SITE_SECTIONS].sort());
  });

  it("falls back to defaults section by section when stored data is damaged", async () => {
    const tenant = await createTenant();
    await asOwner(tenant)((scope) =>
      writeSiteDocument(scope, {
        hero: "not an object",
        stats: [{ label: 1 }],
        featured: { mode: "random" },
        seo: { home: { title: "x".repeat(500) } },
        skills: "Silk Road history",
        contact: { mapLatitude: 40.4 },
        footer: { blurb: "Private journeys across Azerbaijan." },
        languages: [{ name: "English", level: "Native", percent: 100 }],
        unknownSection: { anything: true },
      }),
    );

    const content = await asVisitor(tenant)((scope) => getSiteContent(scope));
    const defaults = defaultSiteContent();
    expect(content.hero).toEqual(defaults.hero);
    expect(content.stats).toEqual([]);
    expect(content.featured).toEqual({ mode: "manual" });
    expect(content.seo).toEqual(defaults.seo);
    expect(content.skills).toEqual([]);
    expect(content.contact).toEqual(defaults.contact);
    // Healthy sections are untouched by their neighbours' problems.
    expect(content.footer).toEqual({ blurb: "Private journeys across Azerbaijan." });
    expect(content.languages).toEqual([{ name: "English", level: "Native", percent: 100 }]);
    expect(content).not.toHaveProperty("unknownSection");
  });
});

describe("site content: updating", () => {
  it("merges an object section over what is stored and audits the change", async () => {
    const tenant = await createTenant();
    const image = await seedMedia(tenant);

    const first = await asOwner(tenant)((scope) =>
      updateSiteContent(scope, "hero", {
        kicker: "  Private & small-group journeys · Azerbaijan ",
        headline: "Discover the world",
        headlineEmphasis: "through local eyes.",
        imageMediaId: image.id,
      }),
    );
    expect(first).toEqual({
      kicker: "Private & small-group journeys · Azerbaijan",
      headline: "Discover the world",
      headlineEmphasis: "through local eyes.",
      body: "",
      imageMediaId: image.id,
      nowGuiding: "",
    });

    const second = await asOwner(tenant)((scope) => updateSiteContent(scope, "hero", { nowGuiding: "Sheki, Greater Caucasus", body: "One line.\nTwo." }));
    expect(second).toMatchObject({ headline: "Discover the world", imageMediaId: image.id, nowGuiding: "Sheki, Greater Caucasus", body: "One line.\nTwo." });

    const cleared = await asOwner(tenant)((scope) => updateSiteContent(scope, "hero", { imageMediaId: null, kicker: "" }));
    expect(cleared).toMatchObject({ imageMediaId: null, kicker: "", headline: "Discover the world" });

    expect((await asVisitor(tenant)((scope) => getSiteContent(scope))).hero).toEqual(cleared);
    expect((await auditActions(tenant)).filter((action) => action === "site_content.updated")).toHaveLength(3);
  });

  it("replaces list sections whole", async () => {
    const tenant = await createTenant();
    const update = <K extends SiteSection>(section: K, input: unknown) => asOwner(tenant)((scope) => updateSiteContent(scope, section, input));

    expect(await update("stats", [{ label: "Guests guided since 2014", value: "2,900+" }, { label: "Tours completed", value: "940" }])).toHaveLength(2);
    expect(await update("stats", [{ label: "Places explored", value: "48" }])).toEqual([{ label: "Places explored", value: "48" }]);

    expect(await update("valueProps", [{ title: "Local expertise", text: "Born and raised here.", icon: "compass" }, { title: "Safe & comfortable", icon: "shield" }])).toEqual([
      { title: "Local expertise", text: "Born and raised here.", icon: "compass" },
      { title: "Safe & comfortable", text: "", icon: "shield" },
    ]);
    expect(await update("languages", [{ name: "Azerbaijani", level: "Native", percent: 100 }, { name: "English", percent: 92 }])).toEqual([
      { name: "Azerbaijani", level: "Native", percent: 100 },
      { name: "English", level: "", percent: 92 },
    ]);
    expect(await update("skills", ["Silk Road history", " Mountain   leadership "])).toEqual(["Silk Road history", "Mountain leadership"]);
    expect(await update("qualifications", [{ year: "2014", title: "Licensed Tour Guide", issuer: "Azerbaijan Tourism Board" }])).toEqual([
      { year: "2014", title: "Licensed Tour Guide", issuer: "Azerbaijan Tourism Board" },
    ]);
    expect(await update("milestones", [{ year: "2017", title: "First mountain expedition" }])).toEqual([
      { year: "2017", title: "First mountain expedition", text: "" },
    ]);
    expect(await update("faq", [{ question: "Do you offer private tours?", answer: "Yes.\nEvery tour can be private." }])).toEqual([
      { question: "Do you offer private tours?", answer: "Yes.\nEvery tour can be private." },
    ]);
    expect(await update("skills", [])).toEqual([]);

    const content = await asVisitor(tenant)((scope) => getSiteContent(scope));
    expect(content.stats).toEqual([{ label: "Places explored", value: "48" }]);
    expect(content.skills).toEqual([]);
    expect(content.faq).toHaveLength(1);
  });

  it("updates about, contact, footer, featured mode and legal text", async () => {
    const tenant = await createTenant();
    const portrait = await seedMedia(tenant);
    const update = <K extends SiteSection>(section: K, input: unknown) => asOwner(tenant)((scope) => updateSiteContent(scope, section, input));

    expect(
      await update("about", {
        portraitMediaId: portrait.id,
        credentialLine: "Licensed guide · Art historian · Mountain leader",
        shortBio: "I grew up in Baku.",
        longBio: "First paragraph.\n\nSecond paragraph.",
        philosophyQuote: "Travel slowly.",
        licenceLine: "Azerbaijan Tourism Board · No. AZ-2014-318",
      }),
    ).toMatchObject({ portraitMediaId: portrait.id, longBio: "First paragraph.\n\nSecond paragraph." });

    expect(
      await update("contact", {
        hours: "Mon – Sat · 9:00 – 19:00\nSunday · WhatsApp only",
        responseTime: "I reply personally within 24 hours.",
        mapLatitude: 40.3661,
        mapLongitude: 49.8372,
        serviceLocations: ["Baku", "Sheki"],
      }),
    ).toEqual({
      hours: "Mon – Sat · 9:00 – 19:00\nSunday · WhatsApp only",
      responseTime: "I reply personally within 24 hours.",
      mapLatitude: 40.3661,
      mapLongitude: 49.8372,
      serviceLocations: ["Baku", "Sheki"],
    });
    // A partial update keeps the coordinates.
    expect(await update("contact", { hours: "By appointment" })).toMatchObject({ hours: "By appointment", mapLatitude: 40.3661, mapLongitude: 49.8372 });
    expect(await update("contact", { mapLatitude: null, mapLongitude: null })).toMatchObject({ mapLatitude: null, mapLongitude: null });

    expect(await update("footer", { blurb: "Private and small-group journeys across Azerbaijan." })).toEqual({
      blurb: "Private and small-group journeys across Azerbaijan.",
    });
    for (const mode of ["popular", "rated", "manual"] as const) expect(await update("featured", { mode })).toEqual({ mode });
    expect(await update("legal", { privacy: "We keep your details private.", terms: "Bookings are confirmed by e-mail." })).toEqual({
      privacy: "We keep your details private.",
      terms: "Bookings are confirmed by e-mail.",
    });
    expect(await update("legal", { terms: "" })).toEqual({ privacy: "We keep your details private.", terms: "" });
  });

  it("merges SEO page by page, and field by field inside a page", async () => {
    const tenant = await createTenant();
    const update = (input: unknown) => asOwner(tenant)((scope) => updateSiteContent(scope, "seo", input));

    await update({ home: { title: "Aurelia Journeys — Private Tours in Azerbaijan", description: "Small-group and private journeys." } });
    await update({ about: { title: "About Leyla" } });
    const seo = await update({ home: { description: "Guided by a licensed local guide." } });

    expect(seo.home).toEqual({ title: "Aurelia Journeys — Private Tours in Azerbaijan", description: "Guided by a licensed local guide." });
    expect(seo.about).toEqual({ title: "About Leyla", description: "" });
    for (const page of ["experiences", "journey", "reviews", "contact", "offers"] as const) expect(seo[page]).toEqual(emptyPage);
    // A page that does not exist is ignored, not stored.
    expect(await update({ pricing: { title: "Nope" } })).not.toHaveProperty("pricing");
  });

  it("enforces strict limits with field-level errors", async () => {
    const tenant = await createTenant();
    const run = (section: SiteSection, input: unknown) => failure(() => asOwner(tenant)((scope) => updateSiteContent(scope, section, input)));

    expect(await run("hero", { headline: "x".repeat(121) })).toMatchObject({
      name: "ValidationError",
      fieldErrors: { headline: ["Keep this under 120 characters."] },
    });
    expect((await run("seo", { home: { title: "x".repeat(71) } })).fieldErrors).toEqual({ "home.title": ["Keep this under 70 characters."] });
    expect((await run("seo", { contact: { description: "x".repeat(201) } })).fieldErrors).toHaveProperty("contact.description");
    expect((await run("seo", { home: "Just a title" })).fieldErrors).toHaveProperty("home");
    expect((await run("stats", Array.from({ length: 7 }, (_, i) => ({ label: `L${i}`, value: "1" })))).fieldErrors).toEqual({
      form: ["Show up to 6 figures."],
    });
    expect((await run("stats", [{ label: "", value: "12" }])).fieldErrors).toHaveProperty("0.label");
    expect((await run("valueProps", [{ title: "Bad icon", icon: "skull" }])).fieldErrors).toEqual({ "0.icon": ["Choose one of the listed icons."] });
    expect((await run("valueProps", [{ title: "Raw SVG", icon: "<svg onload=alert(1)>" }])).fieldErrors).toHaveProperty("0.icon");
    expect((await run("languages", [{ name: "English", percent: 101 }])).fieldErrors).toHaveProperty("0.percent");
    expect((await run("languages", [{ name: "English", percent: 50.5 }])).fieldErrors).toHaveProperty("0.percent");
    expect((await run("qualifications", [{ year: "14", title: "Licence" }])).fieldErrors).toEqual({ "0.year": ["Use a four-digit year."] });
    expect((await run("milestones", [{ year: "2020" }])).fieldErrors).toHaveProperty("0.title");
    expect((await run("faq", [{ question: "Why?", answer: "" }])).fieldErrors).toHaveProperty("0.answer");
    expect((await run("skills", Array.from({ length: 21 }, (_, i) => `Skill ${i}`))).fieldErrors).toHaveProperty("form");
    expect((await run("featured", { mode: "newest" })).fieldErrors).toHaveProperty("mode");
    expect((await run("legal", { privacy: "x".repeat(20_001) })).fieldErrors).toHaveProperty("privacy");
    expect((await run("contact", { mapLatitude: 91, mapLongitude: 0 })).fieldErrors).toHaveProperty("mapLatitude");
    expect((await run("contact", { mapLatitude: 40.4 })).fieldErrors).toEqual({ mapLongitude: ["Set both latitude and longitude, or neither."] });
    expect((await run("contact", { serviceLocations: "Baku" })).fieldErrors).toHaveProperty("serviceLocations");

    // Nothing above was stored.
    expect(await asOwner(tenant)((scope) => readSiteDocument(scope))).toEqual({});
  });

  it("stores plain text only", async () => {
    const tenant = await createTenant();
    const run = (section: SiteSection, input: unknown) => failure(() => asOwner(tenant)((scope) => updateSiteContent(scope, section, input)));
    const refused = ["Plain text only: HTML tags are not allowed."];

    expect((await run("hero", { headline: "Discover <em>Baku</em>" })).fieldErrors).toEqual({ headline: refused });
    expect((await run("about", { longBio: "Hello<script>alert(1)</script>" })).fieldErrors).toEqual({ longBio: refused });
    expect((await run("faq", [{ question: "Safe?", answer: "<a href='javascript:x'>yes</a>" }])).fieldErrors).toEqual({ "0.answer": refused });
    expect((await run("legal", { terms: "<h1>Terms</h1>" })).fieldErrors).toEqual({ terms: refused });
    expect((await run("skills", ["<b>History</b>"])).fieldErrors).toEqual({ "0": refused });
  });

  it("accepts only media from this workspace's library", async () => {
    const tenant = await createTenant();
    const missing = randomId();

    expect(await failure(() => asOwner(tenant)((scope) => updateSiteContent(scope, "hero", { imageMediaId: missing })))).toMatchObject({
      name: "ValidationError",
      fieldErrors: { imageMediaId: ["Choose an image from your media library."] },
    });
    expect(await failure(() => asOwner(tenant)((scope) => updateSiteContent(scope, "about", { portraitMediaId: missing })))).toMatchObject({
      name: "ValidationError",
      fieldErrors: { portraitMediaId: ["Choose an image from your media library."] },
    });
    expect((await failure(() => asOwner(tenant)((scope) => updateSiteContent(scope, "hero", { imageMediaId: "abc" })))).fieldErrors).toHaveProperty(
      "imageMediaId",
    );
  });

  it("refuses unknown sections and the wrong shape for a section", async () => {
    const tenant = await createTenant();
    expect(await failure(() => asOwner(tenant)((scope) => updateSiteContent(scope, "constructor" as never, {})))).toMatchObject({
      name: "ValidationError",
    });
    expect(await failure(() => asOwner(tenant)((scope) => updateSiteContent(scope, "theme" as never, {})))).toMatchObject({
      name: "ValidationError",
    });
    for (const input of [null, "text", ["a"]]) {
      expect((await failure(() => asOwner(tenant)((scope) => updateSiteContent(scope, "hero", input)))).fieldErrors).toEqual({
        form: ["Send the section's fields as an object."],
      });
    }
    expect(await failure(() => asOwner(tenant)((scope) => updateSiteContent(scope, "stats", { label: "x" })))).toMatchObject({
      name: "ValidationError",
    });
  });

  it("saving one section leaves the stored data of the others alone", async () => {
    const tenant = await createTenant();
    await asOwner(tenant)((scope) => writeSiteDocument(scope, { stats: [{ label: 1 }], footer: { blurb: "Kept." } }));

    await asOwner(tenant)((scope) => updateSiteContent(scope, "featured", { mode: "rated" }));

    expect(await asOwner(tenant)((scope) => readSiteDocument(scope))).toEqual({
      stats: [{ label: 1 }],
      footer: { blurb: "Kept." },
      featured: { mode: "rated" },
    });
  });

  it("offers a non-empty icon allow-list of plain names", () => {
    expect(VALUE_PROP_ICONS.length).toBeGreaterThan(10);
    for (const icon of VALUE_PROP_ICONS) expect(icon).toMatch(/^[a-z]+$/);
    expect(new Set(VALUE_PROP_ICONS).size).toBe(VALUE_PROP_ICONS.length);
  });
});
