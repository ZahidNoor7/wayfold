"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ExternalLink, ImagePlus, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { createCategoryAction, publishTourAction, restoreTourAction, saveTourAction, unpublishTourAction } from "@/app/workspace/tours/actions";
import { Field, firstError } from "@/components/form";
import { Spinner } from "@/components/overlays";
import { MediaPicker, MediaThumb } from "@/components/workspace/media/media-picker";
import { useAction } from "@/hooks/use-action";
import { formatMoney } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { BlocksSection, type BlockRow } from "./blocks-section";
import type { CategoryOption } from "./category-manager";
import { DeparturesSection, type DepartureRow } from "./departures-section";
import { MoveButtons, Section, TextList, ToggleRow } from "./editor-parts";
import {
  KIND_OPTIONS,
  SECTION_LABELS,
  WEEKDAYS,
  flattenFormErrors,
  locateErrors,
  locateField,
  parseMoney,
  sectionsFor,
  slugFromTitle,
  tourFormSchema,
  valuesToPayload,
  type DepartureDay,
  type LocatedError,
  type SectionId,
  type TourFormValues,
  type TourKind,
  type TourStatus,
} from "./tour-form-model";

export interface TourEditorProps {
  /** The stored tour, or null while creating one. */
  tour: { id: string; status: TourStatus; kind: TourKind; slug: string; publishedAt: string | null } | null;
  initial: TourFormValues;
  currency: string;
  timezone: string;
  /** Origin of the public website, e.g. `https://acme.example.com`. */
  storefrontOrigin: string;
  categories: CategoryOption[];
  destinations: { id: string; name: string }[];
  canPublish: boolean;
  /** The member may browse the media library (needed to pick files). */
  canPickMedia: boolean;
  canUploadMedia: boolean;
  departures: DepartureRow[];
  departureDays: Record<string, DepartureDay>;
  blocks: BlockRow[];
  today: string;
  /** Published tours against the plan's allowance; `limit` null = unlimited. */
  publishing: { published: number; limit: number | null };
}

/** What the server says when it has nothing more specific than the per-field messages. */
const GENERIC_VALIDATION = "Please check the highlighted fields.";

const STATUS_BADGE: Record<TourStatus, { className: string; label: string }> = {
  draft: { className: "badge badge-outline text-muted-foreground", label: "Draft" },
  published: { className: "badge badge-confirmed", label: "Published" },
  archived: { className: "badge badge-secondary", label: "Archived" },
};

export function TourEditor({
  tour,
  initial,
  currency,
  timezone,
  storefrontOrigin,
  categories,
  destinations,
  canPublish,
  canPickMedia,
  canUploadMedia,
  departures,
  departureDays,
  blocks,
  today,
  publishing,
}: TourEditorProps) {
  const router = useRouter();
  const creating = tour === null;
  const schema = useMemo(() => tourFormSchema(currency, { requireSlug: !creating }), [currency, creating]);
  const form = useForm<TourFormValues>({ resolver: zodResolver(schema), defaultValues: initial });
  const { control, register, setValue } = form;
  const { errors, isDirty } = form.formState;

  const slots = useFieldArray({ control, name: "slots" });
  const itinerary = useFieldArray({ control, name: "itinerary" });
  const faq = useFieldArray({ control, name: "faq" });
  const media = useFieldArray({ control, name: "media" });

  const kind = useWatch({ control, name: "kind" });
  const title = useWatch({ control, name: "title" });
  const slug = useWatch({ control, name: "slug" });
  const weekdays = useWatch({ control, name: "weekdays" });
  const priceAdult = useWatch({ control, name: "priceAdult" });
  const isFeatured = useWatch({ control, name: "isFeatured" });
  const isPopular = useWatch({ control, name: "isPopular" });
  const categoryId = useWatch({ control, name: "categoryId" });

  const [categoryList, setCategoryList] = useState(categories);
  const [newCategory, setNewCategory] = useState<{ name: string; error: string | null } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [planRefusal, setPlanRefusal] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const save = useAction(saveTourAction, { toastError: false });
  const publish = useAction(publishTourAction, { toastError: false });
  const unpublish = useAction(unpublishTourAction);
  const restore = useAction(restoreTourAction);
  const addCategory = useAction(createCategoryAction, { success: "Category added", toastError: false });

  // Leaving the page with unsaved edits asks first.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  /* -------------------------------------------------------------- errors */

  const clientErrors = flattenFormErrors(errors);
  const serverErrors: Record<string, string[]> | undefined = save.fieldErrors ?? publish.fieldErrors;
  const located: LocatedError[] = [
    ...Object.entries(clientErrors).map(([field, message]) => ({ field, ...locateField(field), message })),
    // A field the browser already flags is not listed twice.
    ...locateErrors(serverErrors).filter((error) => !(error.field in clientErrors)),
  ];
  const formLevelError = save.error && !save.fieldErrors ? save.error : publish.error && !publish.fieldErrors && !planRefusal ? publish.error : null;
  const sectionHasError = (section: SectionId) => located.some((error) => error.section === section);
  // The server's own sentence when it has one ("A published tour must stay complete…"), else a plain default.
  const serverSentence = publish.fieldErrors ? publish.error : save.fieldErrors ? save.error : null;
  const summaryHeading =
    formLevelError ??
    (serverSentence && serverSentence !== GENERIC_VALIDATION ? serverSentence : publish.fieldErrors ? "This tour is not ready to publish yet." : "Some details need another look before this can be saved.");

  /** Message for a field: what the browser found first, then what the server said. */
  const message = (name: string): string | null => clientErrors[name] ?? firstError(serverErrors, name);
  const focusSummary = () => requestAnimationFrame(() => summaryRef.current?.focus());

  /* --------------------------------------------------------------- actions */

  async function saveValues(values: TourFormValues) {
    setPlanRefusal(null);
    publish.reset();
    const result = await save.run({ id: tour?.id, ...valuesToPayload(values, currency) });
    if (!result.ok) {
      focusSummary();
      return;
    }
    // The stored values are now the baseline, so "unsaved changes" clears.
    form.reset({ ...values, slug: result.data.slug });
    if (result.data.created) {
      toast.success("Tour created as a draft");
      router.replace(`/workspace/tours/${result.data.id}`);
    } else {
      toast.success("Tour saved");
    }
  }

  // Built inside the event so the summary's ref is only touched after a submit.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => void form.handleSubmit(saveValues, focusSummary)(event);

  async function publishNow() {
    if (!tour) return;
    setPlanRefusal(null);
    save.reset();
    const result = await publish.run({ id: tour.id });
    if (result.ok) toast.success("Tour published");
    else if (result.code === "plan_limit") setPlanRefusal(result.error);
    else focusSummary();
  }

  async function unpublishNow() {
    if (!tour) return;
    setPlanRefusal(null);
    publish.reset();
    const result = await unpublish.run({ id: tour.id });
    if (result.ok) toast.success("Tour unpublished");
  }

  async function restoreNow() {
    if (!tour) return;
    const result = await restore.run({ id: tour.id });
    if (result.ok) toast.success("Tour restored as a draft");
  }

  async function createCategory() {
    if (!newCategory) return;
    const name = newCategory.name.trim();
    if (!name) {
      setNewCategory({ name: newCategory.name, error: "Add a category name." });
      return;
    }
    const result = await addCategory.run({ name });
    if (result.ok) {
      setCategoryList((current) => [...current, { id: result.data.id, name: result.data.name, tourCount: 0 }]);
      setValue("categoryId", result.data.id, { shouldDirty: true });
      setNewCategory(null);
    } else {
      setNewCategory({ name: newCategory.name, error: result.fieldErrors?.name?.[0] ?? result.error });
    }
  }

  function toggleWeekday(day: number) {
    const next = weekdays.includes(day) ? weekdays.filter((other) => other !== day) : [...weekdays, day].sort((a, b) => a - b);
    setValue("weekdays", next, { shouldDirty: true });
  }

  /* ------------------------------------------------------------- derived */

  const sections = sectionsFor(kind, { saved: !creating });
  const derivedSlug = slugFromTitle(title);
  const shownSlug = slug.trim() || (creating ? derivedSlug : "") || "your-tour";
  const host = storefrontOrigin.replace(/^https?:\/\//, "");
  const price = parseMoney(priceAdult, currency);
  const status = tour?.status ?? "draft";
  const atLimit = publishing.limit !== null && publishing.published >= publishing.limit;
  const publishedOn = tour?.publishedAt ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: timezone }).format(new Date(tour.publishedAt)) : null;

  return (
    <>
    <form onSubmit={onSubmit} noValidate>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <header className="mb-6 sm:mb-8">
        <Link href="/workspace/tours" className="btn btn-link mb-2 h-auto px-0 py-1">
          <ArrowLeft aria-hidden="true" />
          All tours
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold leading-tight text-primary sm:text-4xl">{creating ? "New tour" : title.trim() || "Untitled tour"}</h1>
          {creating ? null : <span className={STATUS_BADGE[status].className}>{STATUS_BADGE[status].label}</span>}
          {tour?.status === "published" ? (
            <a href={`${storefrontOrigin}/experiences/${tour.slug}`} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
              <ExternalLink aria-hidden="true" />
              View on website
            </a>
          ) : null}
        </div>
        {creating ? <p className="mt-2 text-sm text-muted-foreground">Only a title is needed to save a draft. Fill in the rest before you publish.</p> : null}
      </header>

      {located.length > 0 || formLevelError ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="tour-problems" className="alert alert-destructive mb-6 outline-none">
          <p id="tour-problems" className="font-semibold">
            {summaryHeading}
          </p>
          {located.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {located.map((error, index) => (
                <li key={`${error.field}-${index}`}>
                  <a href={`#${error.section}`} className="underline underline-offset-4">
                    {SECTION_LABELS[error.section]} · {error.label}
                  </a>
                  : {error.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <nav aria-label="Sections of this tour" className="sticky top-14 z-20 -mx-5 mb-5 border-b bg-background px-5 py-2 sm:-mx-8 sm:px-8 lg:top-8 lg:mx-0 lg:mb-0 lg:border-0 lg:bg-transparent lg:p-0">
          <ul className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {sections.map((section) => (
              <li key={section} className="shrink-0">
                <a href={`#${section}`} className="side-link h-10 whitespace-nowrap lg:h-10">
                  {SECTION_LABELS[section]}
                  {sectionHasError(section) ? (
                    <span className="ml-auto flex items-center gap-1.5 pl-2 text-xs font-semibold text-destructive">
                      <span aria-hidden="true" className="size-2 rounded-full bg-destructive" />
                      <span className="sr-only">has problems</span>
                    </span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          {/* ---------------------------------------------------------- basics */}
          <Section id="basics" title="Basics" description="What the tour is and how guests find it.">
            <Field label="Title" error={message("title")}>
              {(field) => <input {...field} {...register("title")} className="input" autoComplete="off" />}
            </Field>
            <Field
              label="Web address"
              note={creating ? "optional" : undefined}
              hint={`Guests will find this tour at ${host}/experiences/${shownSlug}`}
              error={message("slug")}
            >
              {(field) => (
                <input
                  {...field}
                  {...register("slug")}
                  className="input font-mono"
                  placeholder={creating ? derivedSlug || "made-from-the-title" : undefined}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              )}
            </Field>
            <Field label="Summary" hint="One or two sentences shown on tour cards and in search results." error={message("summary")}>
              {(field) => <textarea {...field} {...register("summary")} className="textarea" rows={2} />}
            </Field>
            <Field label="Description" error={message("description")}>
              {(field) => <textarea {...field} {...register("description")} className="textarea" rows={6} />}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Field label="Category" error={message("categoryId")}>
                  {(field) => (
                    <select {...field} className="select" value={categoryId} onChange={(event) => setValue("categoryId", event.target.value, { shouldDirty: true })}>
                      <option value="">No category</option>
                      {categoryList.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                {newCategory ? (
                  <div
                    role="group"
                    aria-label="New category"
                    className="flex flex-col gap-2"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void createCategory();
                      }
                    }}
                  >
                    <div className="flex gap-2">
                      <input
                        className="input min-w-0 flex-1"
                        aria-label="Name of the new category"
                        aria-invalid={Boolean(newCategory.error)}
                        placeholder="e.g. Food & local life"
                        value={newCategory.name}
                        autoFocus
                        onChange={(event) => setNewCategory({ name: event.target.value, error: null })}
                      />
                      <button type="button" className="btn btn-default h-11 shrink-0" disabled={addCategory.pending} aria-busy={addCategory.pending || undefined} onClick={() => void createCategory()}>
                        {addCategory.pending ? <Spinner /> : null}
                        Add
                      </button>
                      <button type="button" className="btn btn-ghost btn-icon h-11 shrink-0" aria-label="Cancel new category" onClick={() => setNewCategory(null)}>
                        <X aria-hidden="true" />
                      </button>
                    </div>
                    {newCategory.error ? (
                      <span role="alert" className="field-error">
                        {newCategory.error}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div>
                    <button type="button" className="btn btn-link h-auto px-0 py-1" onClick={() => setNewCategory({ name: "", error: null })}>
                      <Plus aria-hidden="true" />
                      New category
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Field label="Destination" error={message("destinationId")}>
                  {(field) => (
                    <select {...field} {...register("destinationId")} className="select">
                      <option value="">No destination</option>
                      {destinations.map((destination) => (
                        <option key={destination.id} value={destination.id}>
                          {destination.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <div>
                  <a href="/workspace/destinations" target="_blank" rel="noreferrer" className="btn btn-link h-auto px-0 py-1">
                    Manage destinations
                    <ExternalLink aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </div>
              </div>
            </div>

            <Field label="Place" note="optional" hint="A short line for cards, such as the town or region." error={message("place")}>
              {(field) => <input {...field} {...register("place")} className="input" />}
            </Field>

            <fieldset>
              <legend className="label mb-3">How it is sold</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {KIND_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer flex-col gap-1 rounded-lg border p-4 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40"
                  >
                    <input type="radio" value={option.value} {...register("kind")} className="sr-only" />
                    <span className="text-sm font-semibold">{option.label}</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">{option.explanation}</span>
                  </label>
                ))}
              </div>
              {message("kind") ? (
                <span role="alert" className="field-error mt-2 block">
                  {message("kind")}
                </span>
              ) : null}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              {kind === "day" ? null : (
                <Field label="Length in days" error={message("durationDays")}>
                  {(field) => <input {...field} {...register("durationDays")} className="input" inputMode="numeric" />}
                </Field>
              )}
              <Field
                label="Duration shown to guests"
                note="optional"
                hint={kind === "day" ? "A day tour lasts one day. Say how long in your own words, such as “6 hours”." : "Your own wording, such as “3 days, 2 nights”. Left empty, the length in days is shown."}
                error={message("durationLabel")}
              >
                {(field) => <input {...field} {...register("durationLabel")} className="input" placeholder={kind === "day" ? "e.g. 6 hours" : "e.g. 3 days"} />}
              </Field>
            </div>
          </Section>

          {/* --------------------------------------------------------- pricing */}
          <Section id="pricing" title="Pricing & group" description="Prices are per person.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label={`Adult price (${currency})`}
                hint={price.ok && price.minor > 0 ? `Shown to guests as ${formatMoney(price.minor, currency)}` : "Needed before the tour can be published."}
                error={message("priceAdult")}
              >
                {(field) => <input {...field} {...register("priceAdult")} className="input" inputMode="decimal" placeholder="0" autoComplete="off" />}
              </Field>
              <Field label="Child price (%)" hint="Share of the adult price. 50 means half price, 0 means free." error={message("childPricePercent")}>
                {(field) => <input {...field} {...register("childPricePercent")} className="input" inputMode="numeric" />}
              </Field>
              <Field label="Child age limit" hint="Guests up to this age pay the child price." error={message("childMaxAge")}>
                {(field) => <input {...field} {...register("childMaxAge")} className="input" inputMode="numeric" />}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Smallest group" error={message("minGroupSize")}>
                {(field) => <input {...field} {...register("minGroupSize")} className="input" inputMode="numeric" />}
              </Field>
              <Field label="Largest group" error={message("maxGroupSize")}>
                {(field) => <input {...field} {...register("maxGroupSize")} className="input" inputMode="numeric" />}
              </Field>
            </div>
          </Section>

          {/* -------------------------------------------------------- schedule */}
          <Section
            id="schedule"
            title="Schedule"
            description={
              kind === "day"
                ? "Guests can book this tour on the days and start times below."
                : kind === "departure"
                  ? "This tour runs on the departure dates you add. The days below are kept for reference."
                  : "Private tours are booked by date. The days below are kept for reference."
            }
            error={firstError(serverErrors, "schedule")}
          >
            <div role="group" aria-labelledby="weekdays-label" className="flex flex-col gap-3">
              <p id="weekdays-label" className="label">
                Days of the week
              </p>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => (
                  <button key={day.value} type="button" className="chip" aria-pressed={weekdays.includes(day.value)} aria-label={day.long} onClick={() => toggleWeekday(day.value)}>
                    {day.short}
                  </button>
                ))}
              </div>
              {kind === "day" && weekdays.length === 0 ? <p className="field-hint">Choose at least one day before publishing.</p> : null}
            </div>

            {kind === "day" ? (
              <div role="group" aria-labelledby="slots-label" className="flex flex-col gap-3">
                <div>
                  <p id="slots-label" className="label">
                    Start times
                  </p>
                  <p className="field-hint mt-1.5">Each start time has its own number of seats per day.</p>
                </div>
                {slots.fields.length > 0 ? (
                  <ul className="flex flex-col gap-3">
                    {slots.fields.map((slot, index) => (
                      <li key={slot.id} className="flex flex-col gap-1">
                        <div className="flex items-end gap-2">
                          <label className="flex flex-1 flex-col gap-2">
                            <span className={cn("label", index > 0 && "sr-only")}>Start time</span>
                            <input type="time" {...register(`slots.${index}.time` as const)} className="input" aria-invalid={Boolean(message(`slots.${index}.time`))} />
                          </label>
                          <label className="flex flex-1 flex-col gap-2">
                            <span className={cn("label", index > 0 && "sr-only")}>Seats</span>
                            <input {...register(`slots.${index}.capacity` as const)} className="input" inputMode="numeric" placeholder="e.g. 8" aria-invalid={Boolean(message(`slots.${index}.capacity`))} />
                          </label>
                          <button type="button" className="btn btn-ghost btn-icon h-11 shrink-0" aria-label={`Remove start time ${index + 1}`} onClick={() => slots.remove(index)}>
                            <X aria-hidden="true" />
                          </button>
                        </div>
                        {message(`slots.${index}.time`) ?? message(`slots.${index}.capacity`) ? (
                          <span role="alert" className="field-error">
                            {message(`slots.${index}.time`) ?? message(`slots.${index}.capacity`)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No start times yet. A day tour needs at least one before it can be published.</p>
                )}
                {clientErrors.slots ? (
                  <span role="alert" className="field-error">
                    {clientErrors.slots}
                  </span>
                ) : null}
                <div>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => slots.append({ time: "", capacity: "" })}>
                    <Plus aria-hidden="true" />
                    Add start time
                  </button>
                </div>
              </div>
            ) : null}
          </Section>

          {/* ------------------------------------------------------ departures */}
          {sections.includes("departures") ? (
            <Section id="departures" title="Departures" description="The dates this tour leaves on. Changes here are saved straight away." error={firstError(serverErrors, "departures")}>
              {tour && tour.kind === "departure" ? (
                <DeparturesSection tourId={tour.id} departures={departures} days={departureDays} today={today} />
              ) : (
                <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">Save the tour first, then add its departure dates here.</p>
              )}
            </Section>
          ) : null}

          {/* ---------------------------------------------------------- blocks */}
          {tour ? (
            <Section id="blocks" title="Availability blocks" description="Dates on which this tour cannot be booked, whatever its schedule says. Changes here are saved straight away.">
              <BlocksSection tourId={tour.id} blocks={blocks} today={today} />
            </Section>
          ) : null}

          {/* ------------------------------------------------------- itinerary */}
          <Section id="itinerary" title="Itinerary" description="What happens, in order. One entry per day, or per stop on a day tour." error={firstError(serverErrors, "days")}>
            {itinerary.fields.length > 0 ? (
              <ol className="flex flex-col gap-4">
                {itinerary.fields.map((day, index) => (
                  <li key={day.id} className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-sm font-bold">Day {index + 1}</p>
                      <span className="flex items-center">
                        <MoveButtons
                          label={`day ${index + 1}`}
                          index={index}
                          count={itinerary.fields.length}
                          onMove={(to) => {
                            itinerary.move(index, to);
                            setAnnouncement(`Day ${index + 1} moved to position ${to + 1} of ${itinerary.fields.length}.`);
                          }}
                        />
                        <button type="button" className="btn btn-ghost btn-icon btn-sm text-destructive hover:text-destructive" aria-label={`Remove day ${index + 1}`} onClick={() => itinerary.remove(index)}>
                          <Trash2 aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                    <div className="flex flex-col gap-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Title" error={message(`itinerary.${index}.title`)}>
                          {(field) => <input {...field} {...register(`itinerary.${index}.title` as const)} className="input" />}
                        </Field>
                        <Field label="Location" note="optional" error={message(`itinerary.${index}.location`)}>
                          {(field) => <input {...field} {...register(`itinerary.${index}.location` as const)} className="input" />}
                        </Field>
                      </div>
                      <Field label="What happens" note="optional" error={message(`itinerary.${index}.description`)}>
                        {(field) => <textarea {...field} {...register(`itinerary.${index}.description` as const)} className="textarea" rows={3} />}
                      </Field>
                      <Field label="Extra line" note="optional" hint="Shown small under the day, such as meals included or where the night is spent." error={message(`itinerary.${index}.meta`)}>
                        {(field) => <input {...field} {...register(`itinerary.${index}.meta` as const)} className="input" />}
                      </Field>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No itinerary yet. Guests like to see how the time is spent.</p>
            )}
            {clientErrors.itinerary ? (
              <span role="alert" className="field-error">
                {clientErrors.itinerary}
              </span>
            ) : null}
            <div>
              <button type="button" className="btn btn-outline" onClick={() => itinerary.append({ title: "", location: "", description: "", meta: "" })}>
                <Plus aria-hidden="true" />
                Add day
              </button>
            </div>
          </Section>

          {/* --------------------------------------------------------- details */}
          <Section id="details" title="Details" description="The practical information guests look for before booking.">
            <TextList
              control={control}
              register={register}
              name="highlights"
              label="Highlights"
              item="highlight"
              rowError={(index) => message(`highlights.${index}.value`)}
              error={message("highlights")}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <TextList control={control} register={register} name="inclusions" label="Included" item="inclusion" rowError={(index) => message(`inclusions.${index}.value`)} error={message("inclusions")} />
              <TextList control={control} register={register} name="exclusions" label="Not included" item="exclusion" rowError={(index) => message(`exclusions.${index}.value`)} error={message("exclusions")} />
            </div>
            <TextList
              control={control}
              register={register}
              name="goodToKnow"
              label="Good to know"
              hint="What to bring, fitness level, dress code and similar."
              item="note"
              rowError={(index) => message(`goodToKnow.${index}.value`)}
              error={message("goodToKnow")}
            />

            <div role="group" aria-labelledby="faq-label" className="flex flex-col gap-3">
              <p id="faq-label" className="label">
                Questions and answers
              </p>
              {faq.fields.length > 0 ? (
                <ul className="flex flex-col gap-3">
                  {faq.fields.map((item, index) => (
                    <li key={item.id} className="flex flex-col gap-3 rounded-lg border p-4">
                      <div className="flex items-start gap-2">
                        <Field label={`Question ${index + 1}`} error={message(`faq.${index}.question`)} className="flex-1">
                          {(field) => <input {...field} {...register(`faq.${index}.question` as const)} className="input" />}
                        </Field>
                        <button type="button" className="btn btn-ghost btn-icon mt-6 h-11 shrink-0" aria-label={`Remove question ${index + 1}`} onClick={() => faq.remove(index)}>
                          <X aria-hidden="true" />
                        </button>
                      </div>
                      <Field label="Answer" error={message(`faq.${index}.answer`)}>
                        {(field) => <textarea {...field} {...register(`faq.${index}.answer` as const)} className="textarea" rows={2} />}
                      </Field>
                    </li>
                  ))}
                </ul>
              ) : null}
              {message("faq") ? (
                <span role="alert" className="field-error">
                  {message("faq")}
                </span>
              ) : null}
              <div>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => faq.append({ question: "", answer: "" })}>
                  <Plus aria-hidden="true" />
                  Add question
                </button>
              </div>
            </div>

            <TextList
              control={control}
              register={register}
              name="languages"
              label="Languages"
              hint="The languages this tour is guided in."
              item="language"
              placeholder="e.g. English"
              rowError={(index) => message(`languages.${index}.value`)}
              error={message("languages")}
            />

            <Field label="Meeting point" note="optional" error={message("meetingPoint")}>
              {(field) => <input {...field} {...register("meetingPoint")} className="input" />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Latitude" note="optional" hint="With a longitude, the meeting point is shown on a map." error={message("meetingLatitude")}>
                {(field) => <input {...field} {...register("meetingLatitude")} className="input" inputMode="decimal" placeholder="e.g. 40.3661" />}
              </Field>
              <Field label="Longitude" note="optional" error={message("meetingLongitude")}>
                {(field) => <input {...field} {...register("meetingLongitude")} className="input" inputMode="decimal" placeholder="e.g. 49.8372" />}
              </Field>
            </div>
            <Field label="Cancellation policy" note="optional" error={message("cancellationPolicy")}>
              {(field) => <textarea {...field} {...register("cancellationPolicy")} className="textarea" rows={3} />}
            </Field>
          </Section>

          {/* ----------------------------------------------------------- media */}
          <Section id="media" title="Media" description="Photos and videos from your media library. The first one is the cover." error={message("media") ?? firstError(serverErrors, "mediaIds") ?? firstError(serverErrors, "coverMediaId")}>
            {media.fields.length > 0 ? (
              <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {media.fields.map((item, index) => (
                  <li key={item.id} className="overflow-hidden rounded-lg border bg-card">
                    <div className="relative">
                      <MediaThumb media={item} alt={item.alt} className="aspect-[4/3] w-full rounded-none" sizes="(min-width: 1280px) 18vw, (min-width: 640px) 30vw, 46vw" />
                      {index === 0 ? <span className="badge badge-default absolute left-2 top-2">Cover</span> : null}
                    </div>
                    <div className="flex items-center justify-between px-1 py-1">
                      <MoveButtons
                        label={`photo ${index + 1}`}
                        index={index}
                        count={media.fields.length}
                        wording="sequence"
                        onMove={(to) => {
                          media.move(index, to);
                          setAnnouncement(`Photo ${index + 1} moved to position ${to + 1} of ${media.fields.length}${to === 0 ? ". It is now the cover" : ""}.`);
                        }}
                      />
                      <button type="button" className="btn btn-ghost btn-icon btn-sm text-destructive hover:text-destructive" aria-label={`Remove photo ${index + 1} from this tour`} onClick={() => media.remove(index)}>
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No photos yet. Tours with photos are booked far more often.</p>
            )}
            <div>
              {canPickMedia ? (
                <button type="button" className="btn btn-outline" onClick={() => setPickerOpen(true)}>
                  <ImagePlus aria-hidden="true" />
                  {media.fields.length > 0 ? "Change photos" : "Choose from library"}
                </button>
              ) : (
                <p className="field-hint">Your role cannot open the media library. Ask an owner to add photos, or to give you access.</p>
              )}
            </div>
          </Section>

          {/* ------------------------------------------------------ visibility */}
          <Section id="visibility" title="Visibility" description="Where the tour appears on your website.">
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <ToggleRow label="Featured on homepage" hint="Shows in the featured section of your homepage" checked={isFeatured} onChange={(checked) => setValue("isFeatured", checked, { shouldDirty: true })} />
              <ToggleRow label="“Popular” badge" hint="Adds a badge on tour cards" checked={isPopular} onChange={(checked) => setValue("isPopular", checked, { shouldDirty: true })} />
            </div>

            <div className="flex flex-col gap-3 rounded-lg border p-4">
              {creating ? (
                <p className="text-sm text-muted-foreground">New tours are saved as drafts. Once the details are complete you can publish it from here.</p>
              ) : status === "published" ? (
                <>
                  <p className="text-sm">
                    <span className="font-semibold">Live on your website</span>
                    {publishedOn ? <span className="text-muted-foreground"> since {publishedOn}</span> : null}
                  </p>
                  {canPublish ? (
                    <div>
                      <button type="button" className="btn btn-outline" disabled={unpublish.pending} aria-busy={unpublish.pending || undefined} onClick={() => void unpublishNow()}>
                        {unpublish.pending ? <Spinner /> : null}
                        Unpublish
                      </button>
                    </div>
                  ) : null}
                </>
              ) : status === "archived" ? (
                <>
                  <p className="text-sm">
                    <span className="font-semibold">Archived.</span> <span className="text-muted-foreground">It is off your website. Restore it as a draft to work on it and publish it again.</span>
                  </p>
                  <div>
                    <button type="button" className="btn btn-outline" disabled={restore.pending} aria-busy={restore.pending || undefined} onClick={() => void restoreNow()}>
                      {restore.pending ? <Spinner /> : null}
                      Restore as draft
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm">
                    <span className="font-semibold">Draft.</span> <span className="text-muted-foreground">Only your team can see it.</span>
                    {publishing.limit !== null ? (
                      <span className="text-muted-foreground">
                        {" "}
                        {publishing.published} of {publishing.limit} published tours used on your plan.
                      </span>
                    ) : null}
                  </p>
                  {planRefusal ?? (atLimit && canPublish) ? (
                    <div role={planRefusal ? "alert" : undefined} className="alert alert-warning flex flex-wrap items-center justify-between gap-3">
                      <span>{planRefusal ?? "Your plan’s published tours are all in use. Unpublish another tour or upgrade to publish this one."}</span>
                      <Link href="/workspace/billing" className="btn btn-outline btn-sm">
                        See plans
                      </Link>
                    </div>
                  ) : null}
                  {canPublish ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" className="btn btn-default" disabled={isDirty || publish.pending} aria-busy={publish.pending || undefined} onClick={() => void publishNow()}>
                        {publish.pending ? <Spinner /> : null}
                        Publish tour
                      </button>
                      {isDirty ? <p className="field-hint">Save your changes first, then publish.</p> : null}
                    </div>
                  ) : (
                    <p className="field-hint">Your role cannot publish tours. Ask an owner or manager to publish it.</p>
                  )}
                </>
              )}
            </div>
          </Section>
        </div>
      </div>

      {/* Sticky save bar: always in reach, and it says whether there is anything to save. */}
      <div className="glass safe-b sticky bottom-0 z-30 -mx-5 -mb-5 mt-8 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-5 pt-3 backdrop-blur sm:-mx-8 sm:-mb-8 sm:px-8">
        <p className="flex items-center gap-2 text-sm" role="status">
          {isDirty ? (
            <>
              <span aria-hidden="true" className="size-2 rounded-full bg-highlight" />
              <span className="font-semibold">Unsaved changes</span>
            </>
          ) : creating ? (
            <span className="text-muted-foreground">Not saved yet</span>
          ) : (
            <span className="text-muted-foreground">All changes saved</span>
          )}
        </p>
        <div className="flex gap-2">
          {isDirty && !creating ? (
            <button type="button" className="btn btn-outline" disabled={save.pending} onClick={() => form.reset()}>
              Discard
            </button>
          ) : null}
          <button type="submit" className="btn btn-default" disabled={save.pending || (!isDirty && !creating)} aria-busy={save.pending || undefined}>
            {save.pending ? <Spinner /> : null}
            {save.pending ? "Saving…" : creating ? "Create draft" : "Save changes"}
          </button>
        </div>
      </div>

    </form>

      {/* Outside the form: the picker is its own task, and nothing in it should submit the tour. */}
      {canPickMedia ? (
        <MediaPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          multiple
          title="Photos and videos for this tour"
          canUpload={canUploadMedia}
          selectedIds={media.fields.map((item) => item.mediaId)}
          onSelect={(assets) => media.replace(assets.map((asset) => ({ mediaId: asset.id, url: asset.url, alt: asset.alt, resourceType: asset.resourceType })))}
        />
      ) : null}
    </>
  );
}
