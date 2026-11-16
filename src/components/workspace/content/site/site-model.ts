import { z } from "zod";
import { listErrorPath, numberToText, parseOptionalNumber, plainTextField } from "../helpers";

/*
 * Form model for "Pages & content". Every section of the site content is one
 * form; the repeatable sections share one generic list form described by a
 * `ListSpec`. Pure and client-safe: the server module that owns the real
 * schemas is server-only, so the limits are mirrored here for immediate
 * feedback and the server has the last word.
 */

export type EditorTab = "home" | "about" | "contact" | "seo" | "footer";
export const EDITOR_TABS: readonly { id: EditorTab; label: string }[] = [
  { id: "home", label: "Home page" },
  { id: "about", label: "About page" },
  { id: "contact", label: "FAQ & contact" },
  { id: "seo", label: "Search engines" },
  { id: "footer", label: "Footer & legal" },
];

export function parseTab(value: string | string[] | undefined): EditorTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return EDITOR_TABS.some((tab) => tab.id === raw) ? (raw as EditorTab) : "home";
}

/* ------------------------------------------------------------- list forms */

export type ListSectionKey = "stats" | "valueProps" | "languages" | "skills" | "qualifications" | "milestones" | "faq";

export type RowFieldKind = "text" | "textarea" | "percent" | "year" | "icon";

export interface RowFieldSpec {
  key: string;
  label: string;
  kind: RowFieldKind;
  /** Maximum characters (text kinds). */
  max?: number;
  /** 1 = required. */
  min?: number;
  placeholder?: string;
  hint?: string;
}

export interface ListSpec {
  section: ListSectionKey;
  title: string;
  description: string;
  /** Singular name of one row, e.g. "figure". Used in buttons and screen-reader labels. */
  noun: string;
  maxItems: number;
  /** Rows are plain strings on the server; the form keeps them as `{ value }`. */
  scalar?: boolean;
  fields: RowFieldSpec[];
  /** Storefront path where the section shows. */
  path: string;
}

export type Row = Record<string, string>;
export interface ListValues {
  items: Row[];
}

export const LIST_SPECS: Record<ListSectionKey, ListSpec> = {
  stats: {
    section: "stats",
    title: "Highlights band",
    description: "The figures under the home page introduction, e.g. “2,900+ / Guests guided”.",
    noun: "figure",
    maxItems: 6,
    path: "/",
    fields: [
      { key: "value", label: "Figure", kind: "text", max: 20, min: 1, placeholder: "2,900+" },
      { key: "label", label: "Label", kind: "text", max: 60, min: 1, placeholder: "Guests guided" },
    ],
  },
  valueProps: {
    section: "valueProps",
    title: "Why travel with you",
    description: "The reasons listed on the home page, each with an icon.",
    noun: "reason",
    maxItems: 8,
    path: "/",
    fields: [
      { key: "title", label: "Title", kind: "text", max: 60, min: 1 },
      { key: "text", label: "Text", kind: "textarea", max: 300 },
      { key: "icon", label: "Icon", kind: "icon" },
    ],
  },
  languages: {
    section: "languages",
    title: "Languages",
    description: "Shown on the About page with a bar for how well you speak each one.",
    noun: "language",
    maxItems: 12,
    path: "/about",
    fields: [
      { key: "name", label: "Language", kind: "text", max: 40, min: 1, placeholder: "English" },
      { key: "level", label: "Level", kind: "text", max: 40, placeholder: "Fluent" },
      { key: "percent", label: "Bar length", kind: "percent", hint: "0 to 100" },
    ],
  },
  skills: {
    section: "skills",
    title: "Areas of expertise",
    description: "Short tags on the About page.",
    noun: "area",
    maxItems: 20,
    scalar: true,
    path: "/about",
    fields: [{ key: "value", label: "Area of expertise", kind: "text", max: 60, min: 1, placeholder: "Silk Road history" }],
  },
  qualifications: {
    section: "qualifications",
    title: "Qualifications & certifications",
    description: "Licences, courses and memberships on the About page, in the order you list them.",
    noun: "qualification",
    maxItems: 20,
    path: "/about",
    fields: [
      { key: "year", label: "Year", kind: "year" },
      { key: "title", label: "Qualification", kind: "text", max: 120, min: 1 },
      { key: "issuer", label: "Issued by", kind: "text", max: 120 },
    ],
  },
  milestones: {
    section: "milestones",
    title: "Milestones",
    description: "The timeline on the About page.",
    noun: "milestone",
    maxItems: 12,
    path: "/about",
    fields: [
      { key: "year", label: "Year", kind: "year" },
      { key: "title", label: "Title", kind: "text", max: 100, min: 1 },
      { key: "text", label: "Text", kind: "textarea", max: 400 },
    ],
  },
  faq: {
    section: "faq",
    title: "Frequently asked questions",
    description: "Questions and answers visitors see before they get in touch.",
    noun: "question",
    maxItems: 30,
    path: "/contact",
    fields: [
      { key: "question", label: "Question", kind: "text", max: 200, min: 1 },
      { key: "answer", label: "Answer", kind: "textarea", max: 2000, min: 1 },
    ],
  },
};

const yearField = z.string().trim().regex(/^\d{4}$/, "Use a four-digit year.");
// One check, so a bad value gets one message rather than two.
const percentField = z
  .string()
  .trim()
  .refine((value) => /^\d{1,3}$/.test(value) && Number(value) <= 100, "Use a whole number from 0 to 100.");
const iconField = z.string().min(1, "Choose an icon.");

function fieldSchema(field: RowFieldSpec): z.ZodType<string> {
  switch (field.kind) {
    case "year":
      return yearField;
    case "percent":
      return percentField;
    case "icon":
      return iconField;
    default:
      return plainTextField(field.max ?? 200, { min: field.min ?? 0 });
  }
}

/** Client validation for one list form. */
export function listSchema(spec: ListSpec): z.ZodType<ListValues, ListValues> {
  const row = z.object(Object.fromEntries(spec.fields.map((field) => [field.key, fieldSchema(field)])));
  // The row's keys come from the spec, so its type is stated rather than inferred.
  return z.object({ items: z.array(row).max(spec.maxItems, `You can add up to ${spec.maxItems}.`) }) as unknown as z.ZodType<ListValues, ListValues>;
}

/** A blank row; icons start on the first available icon. */
export function emptyRow(spec: ListSpec, icons: readonly string[] = []): Row {
  return Object.fromEntries(spec.fields.map((field) => [field.key, field.kind === "icon" ? (icons[0] ?? "") : field.kind === "percent" ? "100" : ""]));
}

/** Stored list → form rows (every value as text). */
export function rowsFromList(spec: ListSpec, list: readonly unknown[]): Row[] {
  return list.map((item) => {
    if (spec.scalar) return { value: typeof item === "string" ? item : "" };
    const record = (item ?? {}) as Record<string, unknown>;
    return Object.fromEntries(
      spec.fields.map((field) => {
        const value = record[field.key];
        return [field.key, typeof value === "number" ? numberToText(value) : typeof value === "string" ? value : ""];
      }),
    );
  });
}

/** Form rows → what `updateSiteContent` expects for the section. */
export function rowsToInput(spec: ListSpec, rows: readonly Row[]): unknown[] {
  if (spec.scalar) return rows.map((row) => row.value ?? "");
  return rows.map((row) =>
    Object.fromEntries(
      spec.fields.map((field) => {
        const value = row[field.key] ?? "";
        if (field.kind === "percent") return [field.key, Number(value.trim())];
        if (field.kind === "year") return [field.key, value.trim()];
        return [field.key, value];
      }),
    ),
  );
}

/** Server field error key → form path for a list section. */
export function listSectionErrorPath(spec: ListSpec, key: string): string {
  return listErrorPath(key, spec.scalar ? "value" : undefined);
}

/** Accessible name of a row, e.g. "language 2: English". */
export function rowLabel(spec: ListSpec, row: Row, index: number): string {
  const first = (row[spec.fields[0]!.key] ?? "").trim();
  const head = spec.fields[0]!.kind === "year" ? (row[spec.fields[1]?.key ?? ""] ?? "").trim() : first;
  return head ? `${spec.noun} ${index + 1}: ${head}` : `${spec.noun} ${index + 1}`;
}

/* ----------------------------------------------------------- object forms */

export const HERO_LIMITS = { kicker: 80, headline: 120, headlineEmphasis: 80, body: 400, nowGuiding: 120 } as const;
export const ABOUT_LIMITS = { credentialLine: 120, shortBio: 800, longBio: 5000, philosophyQuote: 400, licenceLine: 160 } as const;
export const CONTACT_LIMITS = { hours: 200, responseTime: 120, location: 60, maxLocations: 30 } as const;
export const SEO_LIMITS = { title: 70, description: 200 } as const;
/** What search engines usually show before cutting off. */
export const SEO_SHOWN = { title: 60, description: 160 } as const;
export const FOOTER_LIMIT = 300;
export const LEGAL_LIMIT = 20_000;

export const footerSchema = z.object({ blurb: plainTextField(FOOTER_LIMIT) });
export const legalSchema = z.object({ privacy: plainTextField(LEGAL_LIMIT), terms: plainTextField(LEGAL_LIMIT) });

export const heroSchema = z.object({
  kicker: plainTextField(HERO_LIMITS.kicker),
  headline: plainTextField(HERO_LIMITS.headline),
  headlineEmphasis: plainTextField(HERO_LIMITS.headlineEmphasis),
  body: plainTextField(HERO_LIMITS.body),
  nowGuiding: plainTextField(HERO_LIMITS.nowGuiding),
});

export const aboutSchema = z.object({
  credentialLine: plainTextField(ABOUT_LIMITS.credentialLine),
  shortBio: plainTextField(ABOUT_LIMITS.shortBio),
  longBio: plainTextField(ABOUT_LIMITS.longBio),
  philosophyQuote: plainTextField(ABOUT_LIMITS.philosophyQuote),
  licenceLine: plainTextField(ABOUT_LIMITS.licenceLine),
});

function coordinate(limit: number, name: string) {
  return z.string().refine((value) => {
    const parsed = parseOptionalNumber(value);
    return parsed === null || (parsed !== undefined && Math.abs(parsed) <= limit);
  }, `Use a ${name} between -${limit} and ${limit}, e.g. ${limit === 90 ? "40.3777" : "49.8920"}.`);
}

export const contactSchema = z
  .object({
    hours: plainTextField(CONTACT_LIMITS.hours),
    responseTime: plainTextField(CONTACT_LIMITS.responseTime),
    mapLatitude: coordinate(90, "latitude"),
    mapLongitude: coordinate(180, "longitude"),
    serviceLocations: z
      .array(z.object({ value: plainTextField(CONTACT_LIMITS.location, { min: 1 }) }))
      .max(CONTACT_LIMITS.maxLocations, `You can list up to ${CONTACT_LIMITS.maxLocations} locations.`),
  })
  .refine((value) => (parseOptionalNumber(value.mapLatitude) === null) === (parseOptionalNumber(value.mapLongitude) === null), {
    path: ["mapLongitude"],
    message: "Set both latitude and longitude, or neither.",
  });
export type ContactValues = z.input<typeof contactSchema>;

export interface StoredContact {
  hours: string;
  responseTime: string;
  mapLatitude: number | null;
  mapLongitude: number | null;
  serviceLocations: string[];
}

export function contactToValues(contact: StoredContact): ContactValues {
  return {
    hours: contact.hours,
    responseTime: contact.responseTime,
    mapLatitude: numberToText(contact.mapLatitude),
    mapLongitude: numberToText(contact.mapLongitude),
    serviceLocations: contact.serviceLocations.map((value) => ({ value })),
  };
}

export function contactToInput(values: ContactValues): StoredContact {
  return {
    hours: values.hours,
    responseTime: values.responseTime,
    mapLatitude: parseOptionalNumber(values.mapLatitude) ?? null,
    mapLongitude: parseOptionalNumber(values.mapLongitude) ?? null,
    serviceLocations: values.serviceLocations.map((row) => row.value),
  };
}

/** `serviceLocations.3` → `serviceLocations.3.value`; `form` → `root`; others unchanged. */
export function contactErrorPath(key: string): string {
  if (key === "" || key === "form") return "root";
  const match = /^serviceLocations\.(\d+)$/.exec(key);
  return match ? `serviceLocations.${match[1]}.value` : key;
}

/** Object sections: a whole-form message goes to `root`, field keys stay as they are. */
export function objectErrorPath(key: string): string {
  return key === "" || key === "form" ? "root" : key;
}

export const SEO_PAGE_INFO: Record<string, { label: string; path: string }> = {
  home: { label: "Home", path: "/" },
  about: { label: "About", path: "/about" },
  experiences: { label: "Experiences", path: "/experiences" },
  journey: { label: "Journal", path: "/journey" },
  reviews: { label: "Reviews", path: "/reviews" },
  contact: { label: "Contact", path: "/contact" },
  offers: { label: "Offers", path: "/offers" },
};

export function seoPageInfo(page: string): { label: string; path: string } {
  return SEO_PAGE_INFO[page] ?? { label: page.charAt(0).toUpperCase() + page.slice(1), path: `/${page}` };
}

export function seoSchema(pages: readonly string[]) {
  const page = z.object({ title: plainTextField(SEO_LIMITS.title), description: plainTextField(SEO_LIMITS.description) });
  return z.object(Object.fromEntries(pages.map((name) => [name, page])));
}

/** Pages with an error, so the page picker can flag them. */
export function pagesWithErrors(errors: Record<string, unknown> | undefined, pages: readonly string[]): string[] {
  if (!errors) return [];
  return pages.filter((page) => Boolean(errors[page]));
}

export const FEATURED_MODES = [
  { value: "manual", label: "Tours marked “Featured”", hint: "You choose: tick “Featured” on a tour." },
  { value: "popular", label: "Most popular automatically", hint: "The tours with the most bookings." },
  { value: "rated", label: "Highest rated automatically", hint: "The tours with the best review average." },
] as const;
export type FeaturedMode = (typeof FEATURED_MODES)[number]["value"];
