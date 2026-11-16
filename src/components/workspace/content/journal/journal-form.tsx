"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ImagePlus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch, type FieldPath } from "react-hook-form";
import { createJourneyEntryAction, deleteJourneyEntryAction, updateJourneyEntryAction } from "@/app/workspace/journal/actions";
import { Field, FormError } from "@/components/form";
import { ConfirmDialog } from "@/components/overlays";
import { MediaPicker, MediaThumb } from "@/components/workspace/media/media-picker";
import { useAction } from "@/hooks/use-action";
import { countLabel, displayHost, PLAIN_LINE_HINT, PLAIN_TEXT_HINT, serverErrorEntries } from "../helpers";
import { MediaField } from "../media-field";
import { RowControls } from "../row-controls";
import { SaveBar } from "../save-bar";
import {
  entryHref,
  entryLiveUrl,
  journalDefaults,
  journalErrorPath,
  journalFormSchema,
  JOURNAL_PATH,
  MAX_HIGHLIGHTS,
  MAX_PHOTOS,
  pickedPhotos,
  slugFromTitle,
  toJourneyInput,
  type JournalEntryData,
  type JournalFormValues,
} from "./journal-model";

interface JournalFormProps {
  /** `null` for a new entry. */
  entry: JournalEntryData | null;
  destinations: { id: string; name: string }[];
  tours: { id: string; title: string }[];
  /** Storefront origin, for the address preview and the live link. */
  origin: string;
  /** `can(workspace, "media.manage")`: upload from inside the pickers. */
  canUpload: boolean;
}

/** Create or edit one journal entry: story, highlights, photos and visibility. */
export function JournalForm({ entry, destinations, tours, origin, canUpload }: JournalFormProps) {
  const router = useRouter();
  const isNew = entry === null;
  const [saved, setSaved] = useState<{ slug: string; isPublished: boolean } | null>(entry ? { slug: entry.slug, isPublished: entry.isPublished } : null);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<JournalFormValues>({ resolver: zodResolver(journalFormSchema), defaultValues: journalDefaults(entry) });
  const { register, control, formState, setValue, setError } = form;
  const { errors, isDirty } = formState;
  const highlights = useFieldArray({ control, name: "highlights" });

  const create = useAction(createJourneyEntryAction, { success: "Journal entry created", toastError: false });
  const update = useAction(updateJourneyEntryAction, { success: "Journal entry saved", toastError: false });
  const remove = useAction(deleteJourneyEntryAction, {
    success: `Deleted ${entry?.title ?? "entry"}`,
    onSuccess: () => {
      setConfirmingDelete(false);
      router.push(JOURNAL_PATH);
    },
  });
  const pending = create.pending || update.pending;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const fields = toJourneyInput(values);
    const result = entry ? await update.run({ id: entry.id, fields }) : await create.run({ fields });
    if (result.ok) {
      setSaved({ slug: result.data.slug, isPublished: result.data.isPublished });
      form.reset({ ...values, slug: result.data.slug });
      if (isNew) router.replace(entryHref(result.data.id));
      return;
    }
    const entries = serverErrorEntries(result.fieldErrors, journalErrorPath);
    let focused = false;
    for (const [path, message] of entries) {
      if (path === "root") {
        setFormError(message);
        continue;
      }
      setError(path as FieldPath<JournalFormValues>, { type: "server", message }, { shouldFocus: !focused });
      focused = true;
    }
    if (entries.length === 0) {
      // The address is taken: say so at the slug field, not only above the form.
      if (result.code === "conflict") setError("slug", { type: "server", message: result.error }, { shouldFocus: true });
      else setFormError(result.error);
    }
  });

  const [title, slug, teaser, description, photos, cover] = useWatch({ control, name: ["title", "slug", "teaser", "description", "photos", "cover"] });

  const previewSlug = slug.trim().toLowerCase() || slugFromTitle(title) || "your-entry";
  const liveHref = saved?.isPublished ? entryLiveUrl(origin, saved.slug) : undefined;

  function setPhotos(next: JournalFormValues["photos"]) {
    setValue("photos", next, { shouldDirty: true, shouldValidate: formState.isSubmitted });
  }
  function movePhoto(from: number, to: number) {
    if (to < 0 || to >= photos.length) return;
    const next = [...photos];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setPhotos(next);
  }

  const message = (path: string): string | undefined => {
    const parts = path.split(".");
    let node: unknown = errors;
    for (const part of parts) node = (node as Record<string, unknown> | undefined)?.[part];
    return (node as { message?: string } | undefined)?.message;
  };

  return (
    <>
      <form onSubmit={onSubmit} noValidate className="flex max-w-4xl flex-col gap-6">
        <FormError message={formError} />

        <section className="card" aria-labelledby="journal-story">
          <div className="card-header">
            <h2 id="journal-story" className="card-title">
              Entry
            </h2>
            <p className="card-description">What the entry is called, where and when it happened, and its story.</p>
          </div>
          <div className="card-content flex flex-col gap-4">
            <Field label="Tour or destination name" note={`· ${countLabel(title, 160)}`} error={message("title")}>
              {(control) => <input {...control} {...register("title")} className="input" autoComplete="off" />}
            </Field>
            <Field
              label="Web address"
              note={isNew ? "optional" : undefined}
              error={message("slug")}
              hint={`${displayHost(origin)}/journey/${previewSlug}${isNew && !slug.trim() ? " (generated from the name)" : ""}`}
            >
              {(control) => (
                <input {...control} {...register("slug")} className="input" autoComplete="off" spellCheck={false} placeholder={slugFromTitle(title) || "autumn-in-the-mountains"} />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Destination" note="optional" error={message("destinationId")}>
                {(control) => (
                  <select {...control} {...register("destinationId")} className="select">
                    <option value="">No destination</option>
                    {destinations.map((destination) => (
                      <option key={destination.id} value={destination.id}>
                        {destination.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Location" note="optional" error={message("location")} hint="Shown on the card, e.g. a town or valley.">
                {(control) => <input {...control} {...register("location")} className="input" autoComplete="off" />}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date of visit" note="optional" error={message("visitedMonth")} hint="Month and year. Leave empty for “Undated”.">
                {(control) => <input {...control} {...register("visitedMonth")} className="input" type="month" placeholder="YYYY-MM" />}
              </Field>
              <Field label="Category" note="optional" error={message("category")} hint="Used to filter the journal, e.g. “Mountains”.">
                {(control) => <input {...control} {...register("category")} className="input" autoComplete="off" />}
              </Field>
            </div>
            <Field label="Teaser" note={`· ${countLabel(teaser, 240)}`} error={message("teaser")} hint={`One line for the card. ${PLAIN_LINE_HINT}`}>
              {(control) => <input {...control} {...register("teaser")} className="input" autoComplete="off" />}
            </Field>
            <Field label="Description" note={`· ${countLabel(description, 6000)}`} error={message("description")} hint={PLAIN_TEXT_HINT}>
              {(control) => <textarea {...control} {...register("description")} className="textarea" rows={6} />}
            </Field>
          </div>
        </section>

        <section className="card" aria-labelledby="journal-highlights">
          <div className="card-header">
            <h2 id="journal-highlights" className="card-title">
              Highlights &amp; memorable moments
            </h2>
            <p className="card-description">
              Short lines shown as a list on the entry. Up to {MAX_HIGHLIGHTS}, each under 200 characters.
            </p>
          </div>
          <div className="card-content flex flex-col gap-3">
            {highlights.fields.length === 0 ? <p className="text-sm text-muted-foreground">No highlights yet.</p> : null}
            <ol className="flex flex-col gap-3">
              {highlights.fields.map((field, index) => (
                <li key={field.id} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-3 w-6 shrink-0 text-right text-sm font-semibold text-muted-foreground">
                    {index + 1}.
                  </span>
                  <Field label={`Highlight ${index + 1}`} className="min-w-0 flex-1 [&>label]:sr-only" error={message(`highlights.${index}.value`)}>
                    {(control) => <input {...control} {...register(`highlights.${index}.value`)} className="input" autoComplete="off" />}
                  </Field>
                  <RowControls
                    index={index}
                    count={highlights.fields.length}
                    label={`highlight ${index + 1}`}
                    onMove={(from, to) => highlights.move(from, to)}
                    onRemove={(position) => highlights.remove(position)}
                  />
                </li>
              ))}
            </ol>
            {message("highlights") ? (
              <span role="alert" className="field-error">
                {message("highlights")}
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn-outline btn-sm self-start"
              disabled={highlights.fields.length >= MAX_HIGHLIGHTS}
              onClick={() => highlights.append({ value: "" }, { shouldFocus: true })}
            >
              <Plus aria-hidden="true" />
              Add highlight
            </button>
            {highlights.fields.length >= MAX_HIGHLIGHTS ? <p className="field-hint">You have reached the limit of {MAX_HIGHLIGHTS} highlights.</p> : null}
          </div>
        </section>

        <section className="card" aria-labelledby="journal-photos">
          <div className="card-header">
            <h2 id="journal-photos" className="card-title">
              Photos
            </h2>
            <p className="card-description">The cover leads the entry; the photo set appears in the gallery in this order.</p>
          </div>
          <div className="card-content flex flex-col gap-6">
            <MediaField
              label="Cover image"
              note="optional"
              value={cover}
              onChange={(next) => setValue("cover", next, { shouldDirty: true })}
              error={message("cover")}
              previewClassName="aspect-[16/10] w-40"
              canUpload={canUpload}
              pickerTitle="Choose a cover image"
            />

            <div role="group" aria-labelledby="journal-photo-set" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span id="journal-photo-set" className="label">
                  Photo set
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    · {photos.length} / {MAX_PHOTOS}
                  </span>
                </span>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setPhotoPickerOpen(true)}>
                  <ImagePlus aria-hidden="true" />
                  {photos.length > 0 ? "Add or remove photos" : "Choose photos"}
                </button>
              </div>
              {photos.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No photos yet. Choose images and videos from your media library.
                </p>
              ) : (
                <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {photos.map((photo, index) => (
                    <li key={photo.id} className="flex flex-col gap-1.5">
                      <MediaThumb media={photo} className="aspect-square w-full rounded-lg border" sizes="(min-width: 1024px) 200px, (min-width: 640px) 30vw, 45vw" />
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-muted-foreground">{index + 1}</span>
                        <RowControls
                          index={index}
                          count={photos.length}
                          label={`photo ${index + 1}`}
                          onMove={movePhoto}
                          onRemove={(position) => setPhotos(photos.filter((_, other) => other !== position))}
                        />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {message("photos") ? (
                <span role="alert" className="field-error">
                  {message("photos")}
                </span>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="journal-visibility">
          <div className="card-header">
            <h2 id="journal-visibility" className="card-title">
              Links &amp; visibility
            </h2>
          </div>
          <div className="card-content flex flex-col gap-4">
            <Field label="Related tour" note="optional" error={message("relatedTourId")} hint="Visitors can jump from the entry to this tour while it is published.">
              {(control) => (
                <select {...control} {...register("relatedTourId")} className="select">
                  <option value="">No related tour</option>
                  {tours.map((tour) => (
                    <option key={tour.id} value={tour.id}>
                      {tour.title}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Controller
              control={control}
              name="isPublished"
              render={({ field }) => (
                <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <span>
                    <span id="journal-published" className="block text-sm font-semibold">
                      Published
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {field.value ? "Visible on your website after you save." : "Saved as a draft: only your team can see it."}
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    className="switch"
                    aria-checked={field.value}
                    aria-labelledby="journal-published"
                    onClick={() => field.onChange(!field.value)}
                  >
                    <span className="switch-thumb" />
                  </button>
                </div>
              )}
            />
          </div>
        </section>

        <SaveBar
          className="rounded-xl border"
          pending={pending}
          dirty={isDirty}
          label={isNew ? "Create entry" : "Save entry"}
          viewHref={liveHref}
          viewLabel="View entry on website"
          onDiscard={isNew ? undefined : () => form.reset()}
        />

        {entry ? (
          <div className="flex justify-start">
            <button type="button" className="btn btn-ghost text-destructive hover:text-destructive" onClick={() => setConfirmingDelete(true)}>
              Delete entry
            </button>
          </div>
        ) : null}
      </form>

      <MediaPicker
        open={photoPickerOpen}
        onOpenChange={setPhotoPickerOpen}
        multiple
        max={MAX_PHOTOS}
        title="Choose photos for this entry"
        selectedIds={photos.map((photo) => photo.id)}
        canUpload={canUpload}
        onSelect={(assets) => setPhotos(pickedPhotos(assets))}
      />

      {entry ? (
        <ConfirmDialog
          open={confirmingDelete}
          onOpenChange={(open) => !remove.pending && setConfirmingDelete(open)}
          title={`Delete “${entry.title}”?`}
          description="This removes the entry from your website immediately. Its photos stay in your media library. This can’t be undone."
          confirmLabel="Delete entry"
          cancelLabel="Keep it"
          destructive
          pending={remove.pending}
          onConfirm={() => void remove.run({ id: entry.id })}
        />
      ) : null}
    </>
  );
}
