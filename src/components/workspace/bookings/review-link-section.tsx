"use client";

import { Check, Copy, Link2, Mail, Star } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { createReviewLinkAction, sendReviewRequestAction } from "@/app/workspace/bookings/actions";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import type { BookingReviewView } from "./view-models";

interface ReviewLinkSectionProps {
  bookingId: string;
  customerEmail: string;
  review: BookingReviewView;
  /** bookings.manage: may send or create links. */
  canManage: boolean;
  headingClassName: string;
}

function describe(review: BookingReviewView): string {
  switch (review.state) {
    case "used":
      return "The customer has written their review. Read it and publish it from Reviews.";
    case "open":
      return `A review link has been sent. It works until ${review.expiresOn}.`;
    case "expired":
      return `The review link expired on ${review.expiresOn}. Send a new one if you would still like a review.`;
    default:
      return "Ask the customer to review this tour. They get a private link to a short form on your website; their review waits for you to publish it.";
  }
}

/**
 * The customer's review link for a completed booking: where it stands, and
 * ways to send it. Any new link replaces the previous one, so only the most
 * recent link works.
 */
export function ReviewLinkSection({ bookingId, customerEmail, review, canManage, headingClassName }: ReviewLinkSectionProps) {
  const headingId = useId();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const send = useAction(sendReviewRequestAction, { success: `Review link e-mailed to ${customerEmail}` });
  const create = useAction(createReviewLinkAction);
  const busy = send.pending || create.pending;
  const hasLink = review.state === "open" || review.state === "expired";

  async function copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Review link copied");
    } catch {
      // Some browsers refuse once the click has been awaited; the field below can still be copied by hand.
      setCopied(false);
    }
  }

  async function makeLink(): Promise<void> {
    const result = await create.run({ id: bookingId });
    if (!result.ok) return;
    setLink(result.data.url);
    await copy(result.data.url);
  }

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className={headingClassName}>
        Review
      </h3>
      <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
        <p className="flex items-start gap-2.5">
          <Star aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
          <span>{describe(review)}</span>
        </p>

        {review.state === "used" ? (
          <Link href="/workspace/reviews" className="btn btn-outline btn-sm self-start">
            Open reviews
          </Link>
        ) : canManage ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-default btn-sm"
              disabled={busy}
              aria-busy={send.pending || undefined}
              onClick={() => {
                setLink(null);
                void send.run({ id: bookingId });
              }}
            >
              {send.pending ? <Spinner /> : <Mail aria-hidden="true" />}
              {hasLink ? "E-mail a new link" : "E-mail review link"}
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} aria-busy={create.pending || undefined} onClick={() => void makeLink()}>
              {create.pending ? <Spinner /> : <Link2 aria-hidden="true" />}
              {hasLink ? "Copy a new link" : "Copy review link"}
            </button>
          </div>
        ) : null}

        {link ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${headingId}-link`} className="text-xs font-semibold text-muted-foreground">
              Share this link with the customer, for example on WhatsApp
            </label>
            <div className="flex gap-2">
              <input
                id={`${headingId}-link`}
                readOnly
                value={link}
                className="input h-9 min-w-0 flex-1 font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" className="btn btn-outline btn-sm btn-icon" aria-label="Copy link" onClick={() => void copy(link)}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </button>
            </div>
          </div>
        ) : null}

        {canManage && hasLink && review.state !== "used" ? (
          <p className="text-xs text-muted-foreground">Sending or copying a new link stops the earlier one from working.</p>
        ) : null}
      </div>
    </section>
  );
}
