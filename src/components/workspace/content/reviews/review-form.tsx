"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { createReviewAction, updateReviewAction } from "@/app/workspace/reviews/actions";
import { Field, FormError } from "@/components/form";
import { Spinner } from "@/components/overlays";
import { PLAIN_LINE_HINT, PLAIN_TEXT_HINT, plainTextField, serverErrorEntries } from "@/components/workspace/content/helpers";
import { MediaField, type MediaChoice } from "@/components/workspace/content/media-field";
import { useAction } from "@/hooks/use-action";
import { ReviewMediaField } from "./review-media-field";
import type { ReviewMediaChoice } from "./review-media";
import { StarRatingInput } from "./star-rating-input";
import type { ReviewItem, TourOption } from "./types";

// Immediate feedback only; the reviews service validates again with its own rules.
const reviewSchema = z.object({
  customerName: plainTextField(120, { min: 2, minMessage: "Add the customer’s name." }),
  country: plainTextField(80),
  rating: z.number().int().min(1, "Choose a rating from 1 to 5.").max(5, "Choose a rating from 1 to 5."),
  title: plainTextField(160),
  body: plainTextField(4000, { min: 10, minMessage: "Add the review text (10+ characters)." }),
  reviewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date of the review."),
  tourId: z.string(),
  avatar: z.custom<MediaChoice | null>(),
  media: z.custom<ReviewMediaChoice[]>(),
  isVerified: z.boolean(),
  isFeatured: z.boolean(),
  isPublished: z.boolean(),
});
type ReviewValues = z.infer<typeof reviewSchema>;

/** Server field names that differ from the form's. */
const SERVER_FIELD: Record<string, keyof ReviewValues> = { avatarMediaId: "avatar", mediaIds: "media" };
const FORM_FIELDS = new Set<string>(Object.keys(reviewSchema.shape));

function defaultsFor(review: ReviewItem | null, today: string): ReviewValues {
  return {
    customerName: review?.customerName ?? "",
    country: review?.country ?? "",
    rating: review?.rating ?? 5,
    title: review?.title ?? "",
    body: review?.body ?? "",
    reviewedOn: review?.reviewedOn ?? today,
    tourId: review?.tour?.id ?? "",
    avatar: review?.avatar ? { id: review.avatar.id, url: review.avatar.url } : null,
    media: review?.media.map(({ id, url, alt, resourceType }) => ({ id, url, alt, resourceType })) ?? [],
    isVerified: review?.isVerified ?? false,
    isFeatured: review?.isFeatured ?? false,
    // A review the guide adds is published straight away unless switched off.
    isPublished: review?.isPublished ?? true,
  };
}

interface ReviewFormProps {
  /** The review to edit, or null to add one. */
  review: ReviewItem | null;
  tours: TourOption[];
  today: string;
  canUpload: boolean;
  onCancel: () => void;
  onSaved: () => void;
}

export function ReviewForm({ review, tours, today, canUpload, onCancel, onSaved }: ReviewFormProps) {
  const form = useForm<ReviewValues>({ resolver: zodResolver(reviewSchema), defaultValues: defaultsFor(review, today) });
  const { errors } = form.formState;

  const create = useAction(createReviewAction, { success: "Review added", toastError: false, onSuccess: onSaved });
  const update = useAction(updateReviewAction, { success: "Review updated", toastError: false, onSuccess: onSaved });
  const { pending, error, fieldErrors } = review ? update : create;

  const onSubmit = form.handleSubmit(async (values) => {
    const fields = {
      customerName: values.customerName,
      country: values.country,
      rating: values.rating,
      title: values.title,
      body: values.body,
      reviewedOn: values.reviewedOn,
      tourId: values.tourId || null,
      avatarMediaId: values.avatar?.id ?? null,
      mediaIds: values.media.map((item) => item.id),
      isVerified: values.isVerified,
      isFeatured: values.isFeatured,
      isPublished: values.isPublished,
    };
    const result = review ? await update.run({ id: review.id, fields }) : await create.run({ fields });
    if (result.ok) return;
    let focused = false;
    for (const [key, message] of serverErrorEntries(result.fieldErrors)) {
      const name = SERVER_FIELD[key] ?? key;
      if (!FORM_FIELDS.has(name)) continue;
      form.setError(name as keyof ReviewValues, { type: "server", message }, { shouldFocus: !focused });
      focused = true;
    }
  });

  const message = (name: keyof ReviewValues) => errors[name]?.message ?? null;
  // Anything the server said that has no field of its own is shown above the form.
  const unplaced = serverErrorEntries(fieldErrors).find(([key]) => !FORM_FIELDS.has(SERVER_FIELD[key] ?? key));
  const formLevel = fieldErrors ? (unplaced?.[1] ?? null) : error;

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-full flex-col">
      <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
        <FormError message={formLevel} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer name" error={message("customerName")}>
            {(control) => <input {...control} {...form.register("customerName")} className="input" autoComplete="off" maxLength={140} />}
          </Field>
          <Field label="Country" note="optional" error={message("country")}>
            {(control) => <input {...control} {...form.register("country")} className="input" autoComplete="off" maxLength={100} />}
          </Field>
        </div>

        <Controller
          control={form.control}
          name="rating"
          render={({ field }) => <StarRatingInput value={field.value} onChange={field.onChange} error={message("rating")} />}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tour" error={message("tourId")}>
            {(control) => (
              <select {...control} {...form.register("tourId")} className="select">
                <option value="">General review (no tour)</option>
                {tours.map((tour) => (
                  <option key={tour.id} value={tour.id}>
                    {tour.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Date of review" error={message("reviewedOn")}>
            {(control) => <input {...control} {...form.register("reviewedOn")} className="input" type="date" max={today} />}
          </Field>
        </div>

        <Field label="Review title" note="optional" hint={PLAIN_LINE_HINT} error={message("title")}>
          {(control) => <input {...control} {...form.register("title")} className="input" autoComplete="off" maxLength={180} />}
        </Field>

        <Field label="Full review" hint={PLAIN_TEXT_HINT} error={message("body")}>
          {(control) => <textarea {...control} {...form.register("body")} className="textarea" rows={6} />}
        </Field>

        <Controller
          control={form.control}
          name="avatar"
          render={({ field }) => (
            <MediaField
              label="Customer photo"
              note="optional"
              value={field.value}
              onChange={field.onChange}
              error={message("avatar")}
              previewClassName="size-16 rounded-full"
              canUpload={canUpload}
              pickerTitle="Choose a customer photo"
            />
          )}
        />

        <Controller
          control={form.control}
          name="media"
          render={({ field }) => <ReviewMediaField value={field.value} onChange={field.onChange} error={message("media")} canUpload={canUpload} />}
        />

        <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
          <input type="checkbox" className="checkbox h-5 w-5" {...form.register("isVerified")} />
          Linked to a completed booking (shows “Verified booking”)
        </label>

        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <Controller
            control={form.control}
            name="isPublished"
            render={({ field }) => (
              <SwitchRow
                label="Published"
                hint="Shown on your website’s reviews page."
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="isFeatured"
            render={({ field }) => (
              <SwitchRow
                label="Featured testimonial"
                hint="Shown on your homepage when the review is published."
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </div>
      </div>

      <div className="safe-b sticky bottom-0 flex justify-end gap-2 border-t bg-background px-5 pt-3 sm:px-6">
        <button type="button" className="btn btn-outline" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-default" disabled={pending} aria-busy={pending || undefined}>
          {pending ? <Spinner /> : null}
          {pending ? "Saving…" : "Save review"}
        </button>
      </div>
    </form>
  );
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
        <span className="switch-thumb" />
      </button>
    </div>
  );
}
