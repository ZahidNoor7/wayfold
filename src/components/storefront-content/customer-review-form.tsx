"use client";

import { CheckCircle2, ImagePlus, Play, RotateCcw, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  customerUploadSignatureAction,
  finalizeCustomerUploadAction,
  submitCustomerReviewAction,
} from "@/app/s/[site]/review/[token]/actions";
import { Field } from "@/components/form";
import { Spinner } from "@/components/overlays";
import { StarRatingInput } from "@/components/workspace/content/reviews/star-rating-input";
import { acceptAttribute, describeAllowed, uploadMediaFile, videoPosterUrl } from "@/lib/media-upload";

interface CustomerReviewFormProps {
  token: string;
  businessName: string;
  tourTitle: string;
  defaultName: string;
  defaultCountry: string;
  canUpload: boolean;
  maxFiles: number;
}

interface Attachment {
  key: string;
  name: string;
  state: "uploading" | "done" | "error";
  progress: number;
  error?: string;
  file?: File;
  asset?: { id: string; url: string; resourceType: "image" | "video" };
}

type FieldName = "customerName" | "country" | "rating" | "title" | "body" | "mediaIds";

const BODY_MIN = 20;
const BODY_MAX = 4000;

function clientErrors(values: { customerName: string; rating: number; body: string }): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  if (values.customerName.trim().length < 2) errors.customerName = "Add your name as you would like it shown.";
  if (values.rating < 1) errors.rating = "Choose a rating from 1 to 5.";
  const body = values.body.trim();
  if (body.length < BODY_MIN) errors.body = `Tell us a little more (at least ${BODY_MIN} characters).`;
  else if (body.length > BODY_MAX) errors.body = `Keep your review under ${BODY_MAX} characters.`;
  return errors;
}

let nextKey = 0;

/**
 * The form a customer reaches from their private review link: stars, words
 * and, if the business has storage, photos and videos sent straight to it.
 * After sending, the form is replaced by a thank-you that takes focus.
 */
export function CustomerReviewForm({ token, businessName, tourTitle, defaultName, defaultCountry, canUpload, maxFiles }: CustomerReviewFormProps) {
  const [customerName, setCustomerName] = useState(defaultName);
  const [country, setCountry] = useState(defaultCountry);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const thanks = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadsId = useId();

  useEffect(() => {
    if (sent) thanks.current?.focus();
  }, [sent]);

  const uploading = attachments.some((item) => item.state === "uploading");
  const room = maxFiles - attachments.filter((item) => item.state !== "error").length;

  /** Clears a field's error as soon as the customer changes it. */
  function edited(field: FieldName) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function patch(key: string, change: Partial<Attachment>) {
    setAttachments((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }

  async function upload(key: string, file: File) {
    patch(key, { state: "uploading", progress: 0, error: undefined });
    const outcome = await uploadMediaFile(file, {
      steps: {
        sign: (request) => customerUploadSignatureAction({ ...request, token }),
        complete: (request) => finalizeCustomerUploadAction({ publicId: request.publicId, resourceType: request.resourceType, filename: request.filename, token }),
      },
      onProgress: (phase, fraction) => patch(key, { progress: phase === "processing" ? 1 : fraction }),
    });
    if (outcome.ok) patch(key, { state: "done", progress: 1, asset: outcome.asset, file: undefined });
    else patch(key, { state: "error", error: outcome.reason });
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, Math.max(room, 0));
    event.target.value = "";
    const added = files.map((file) => ({ key: `upload-${(nextKey += 1)}`, name: file.name, state: "uploading" as const, progress: 0, file }));
    setAttachments((list) => [...list, ...added]);
    for (const item of added) void upload(item.key, item.file);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const found = clientErrors({ customerName, rating, body });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (uploading) {
      setFormError("Wait for your photos and videos to finish uploading.");
      return;
    }

    setPending(true);
    const result = await submitCustomerReviewAction({
      token,
      customerName,
      country,
      rating,
      title,
      body,
      mediaIds: attachments.flatMap((item) => (item.state === "done" && item.asset ? [item.asset.id] : [])),
    });
    setPending(false);
    if (result.ok) {
      setSent(true);
      return;
    }
    const fieldErrors: Partial<Record<FieldName, string>> = {};
    for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
      if (messages[0]) fieldErrors[key as FieldName] = messages[0];
    }
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length === 0) setFormError(result.error);
  }

  if (sent) {
    return (
      <div className="card flex flex-col items-center gap-4 p-8 text-center sm:p-12">
        <CheckCircle2 aria-hidden="true" className="size-12 text-primary" strokeWidth={1.5} />
        <h2 ref={thanks} tabIndex={-1} className="font-display text-3xl font-medium text-primary outline-none sm:text-4xl">
          Thank you for your review
        </h2>
        <p className="max-w-md leading-relaxed text-muted-foreground">
          {businessName} will read it shortly, and it will appear on their website once published. Thank you for sharing your time on {tourTitle}.
        </p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="card flex flex-col gap-6 p-6 sm:p-9">
      <StarRatingInput
        value={rating}
        onChange={(value) => {
          setRating(value);
          edited("rating");
        }}
        legend="How would you rate the tour?" error={errors.rating} disabled={pending} />

      <Field label="Your review" error={errors.body} hint={`What stood out? What should future travellers know? ${body.trim().length} / ${BODY_MAX}`}>
        {(control) => (
          <textarea {...control} className="textarea" rows={7} maxLength={BODY_MAX + 200} value={body} onChange={(event) => {
              setBody(event.target.value);
              edited("body");
            }} disabled={pending} />
        )}
      </Field>

      <Field label="Title" note="(optional)" error={errors.title}>
        {(control) => (
          <input {...control} className="input" maxLength={160} value={title} onChange={(event) => {
              setTitle(event.target.value);
              edited("title");
            }} placeholder="In a few words" disabled={pending} />
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name shown with your review" error={errors.customerName} hint="A first name and initial is fine.">
          {(control) => (
            <input {...control} className="input" autoComplete="name" maxLength={120} value={customerName} onChange={(event) => {
              setCustomerName(event.target.value);
              edited("customerName");
            }} disabled={pending} />
          )}
        </Field>
        <Field label="Country" note="(optional)" error={errors.country}>
          {(control) => (
            <input {...control} className="input" autoComplete="country-name" maxLength={80} value={country} onChange={(event) => {
              setCountry(event.target.value);
              edited("country");
            }} disabled={pending} />
          )}
        </Field>
      </div>

      {canUpload ? (
        <div role="group" aria-labelledby={`${uploadsId}-label`} aria-describedby={`${uploadsId}-hint`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span id={`${uploadsId}-label`} className="label">
              Photos and videos <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
            </span>
            <button type="button" className="btn btn-outline btn-sm" disabled={pending || room <= 0} onClick={() => fileInput.current?.click()}>
              <ImagePlus aria-hidden="true" />
              Add photos or videos
            </button>
            <input ref={fileInput} type="file" multiple accept={acceptAttribute()} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onFiles} />
          </div>
          <span id={`${uploadsId}-hint`} className="field-hint">
            Up to {maxFiles} files. {describeAllowed()}.
          </span>
          {attachments.length > 0 ? (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4" aria-live="polite">
              {attachments.map((item) => (
                <li key={item.key} className="flex flex-col gap-1.5">
                  <div className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
                    {item.asset ? (
                      <>
                        <Image
                          src={item.asset.resourceType === "video" ? videoPosterUrl(item.asset.url) : item.asset.url}
                          alt=""
                          fill
                          sizes="140px"
                          className="object-cover"
                        />
                        {item.asset.resourceType === "video" ? (
                          <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-black/25">
                            <Play className="size-5 fill-white text-white" />
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
                        {item.state === "uploading" ? (
                          <span className="flex flex-col items-center gap-2">
                            <Spinner />
                            {Math.round(item.progress * 100)}%
                          </span>
                        ) : (
                          "Not uploaded"
                        )}
                      </span>
                    )}
                    <button
                      type="button"
                      className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-black/60 text-white transition-transform duration-100 active:scale-95 disabled:opacity-50"
                      aria-label={`Remove ${item.name}`}
                      disabled={pending || item.state === "uploading"}
                      onClick={() => setAttachments((list) => list.filter((other) => other.key !== item.key))}
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                  <span className="truncate text-xs text-muted-foreground" title={item.name}>
                    {item.name}
                  </span>
                  {item.state === "error" ? (
                    <span role="alert" className="flex flex-col items-start gap-1 text-xs text-destructive">
                      {item.error}
                      {item.file ? (
                        <button type="button" className="btn btn-link h-auto p-0 text-xs" onClick={() => void upload(item.key, item.file!)}>
                          <RotateCcw aria-hidden="true" className="size-3" />
                          Try again
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {errors.mediaIds ? (
            <span role="alert" className="field-error">
              {errors.mediaIds}
            </span>
          ) : null}
        </div>
      ) : null}

      {formError ? (
        <p role="alert" className="alert alert-destructive">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{businessName} reads every review before it appears on their website.</p>
        <button type="submit" className="btn btn-default btn-lg rounded-full" disabled={pending} aria-busy={pending || undefined}>
          {pending ? <Spinner /> : null}
          Send review
        </button>
      </div>
    </form>
  );
}
