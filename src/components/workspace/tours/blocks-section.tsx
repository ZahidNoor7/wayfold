"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { addAvailabilityBlockAction, removeAvailabilityBlockAction } from "@/app/workspace/tours/actions";
import { firstError } from "@/components/form";
import { ConfirmDialog, Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { formatDateRange } from "./tour-form-model";

export interface BlockRow {
  id: string;
  /** Null for a closure that applies to every tour. */
  tourId: string | null;
  startDate: string;
  endDate: string;
  reason: string;
}

interface BlocksSectionProps {
  tourId: string;
  /** Current and upcoming closures that affect this tour. */
  blocks: BlockRow[];
  today: string;
}

/**
 * Date ranges on which this tour cannot be booked. Saved one at a time, like
 * departures. Closures for the whole business are listed but not editable here.
 */
export function BlocksSection({ tourId, blocks, today }: BlocksSectionProps) {
  const ids = useId();
  const [draft, setDraft] = useState({ startDate: "", endDate: "", reason: "" });
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>(undefined);
  const [toRemove, setToRemove] = useState<BlockRow | null>(null);

  const add = useAction(addAvailabilityBlockAction, { success: "Dates blocked", toastError: false });
  const remove = useAction(removeAvailabilityBlockAction, { success: "Block removed", toastError: false });

  async function submit() {
    const problems: Record<string, string[]> = {};
    if (!draft.startDate) problems.startDate = ["Choose the first day."];
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) problems.endDate = ["The last day cannot be before the first day."];
    if (draft.reason.trim().length > 200) problems.reason = ["Keep the reason under 200 characters."];
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    setErrors(undefined);
    // One day is the common case: an empty last day means "that day only".
    const result = await add.run({ tourId, block: { startDate: draft.startDate, endDate: draft.endDate || draft.startDate, reason: draft.reason.trim() } });
    if (result.ok) setDraft({ startDate: "", endDate: "", reason: "" });
    else setErrors(result.fieldErrors ?? { form: [result.error] });
  }

  async function confirmRemove() {
    if (!toRemove) return;
    const result = await remove.run({ id: toRemove.id, tourId });
    if (result.ok) setToRemove(null);
  }

  const field = (name: "startDate" | "endDate" | "reason") => ({
    id: `${ids}-${name}`,
    "aria-invalid": Boolean(firstError(errors, name)),
    "aria-describedby": firstError(errors, name) ? `${ids}-${name}-error` : undefined,
  });
  const problem = (name: "startDate" | "endDate" | "reason") =>
    firstError(errors, name) ? (
      <span id={`${ids}-${name}-error`} role="alert" className="field-error">
        {firstError(errors, name)}
      </span>
    ) : null;

  return (
    <>
      {blocks.length === 0 ? (
        <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No blocked dates. This tour can be booked on every day its schedule allows.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {blocks.map((block) => (
            <li key={block.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <div className="min-w-0 flex-1 basis-48">
                <p className="font-semibold">{formatDateRange(block.startDate, block.endDate)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{block.reason || "No reason given"}</p>
              </div>
              {block.tourId === null ? (
                <span className="badge badge-secondary" title="This closure applies to every tour, so it cannot be removed from one tour.">
                  All tours
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm text-destructive hover:text-destructive"
                  aria-label={`Remove the block on ${formatDateRange(block.startDate, block.endDate)}`}
                  onClick={() => {
                    remove.reset();
                    setToRemove(block);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div
        role="group"
        aria-label="Block dates"
        className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4"
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          // Enter adds the block instead of saving the whole tour.
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <p className="label">Block dates</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor={`${ids}-startDate`} className="label">
              First day
            </label>
            <input {...field("startDate")} type="date" className="input" min={today} value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} />
            {problem("startDate")}
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${ids}-endDate`} className="label">
              Last day <span className="ml-1.5 font-normal text-muted-foreground">leave empty for one day</span>
            </label>
            <input {...field("endDate")} type="date" className="input" min={draft.startDate || today} value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} />
            {problem("endDate")}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-reason`} className="label">
            Reason <span className="ml-1.5 font-normal text-muted-foreground">optional, only your team sees it</span>
          </label>
          <input {...field("reason")} className="input" placeholder="e.g. Road closed, guide on leave" value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} />
          {problem("reason")}
        </div>
        {firstError(errors, "form") ?? firstError(errors, "tourId") ? (
          <p role="alert" className="field-error">
            {firstError(errors, "form") ?? firstError(errors, "tourId")}
          </p>
        ) : null}
        <div>
          <button type="button" className="btn btn-outline" disabled={add.pending} aria-busy={add.pending || undefined} onClick={() => void submit()}>
            {add.pending ? <Spinner /> : <Plus aria-hidden="true" />}
            Block these dates
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(open) => (open ? undefined : setToRemove(null))}
        title="Remove this block?"
        description={
          <>
            <p>{toRemove ? `${formatDateRange(toRemove.startDate, toRemove.endDate)} becomes bookable again, as far as the schedule allows.` : null}</p>
            {remove.error ? (
              <p role="alert" className="alert alert-destructive mt-3">
                {remove.error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Remove block"
        cancelLabel="Keep it"
        destructive
        pending={remove.pending}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}
