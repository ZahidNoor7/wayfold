"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { addDepartureAction, removeDepartureAction, updateDepartureAction } from "@/app/workspace/tours/actions";
import { firstError } from "@/components/form";
import { ConfirmDialog, Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { departureSeats, formatCalendarDate, parseWhole, type DepartureDay, type DepartureSeats } from "./tour-form-model";

export interface DepartureRow {
  id: string;
  startDate: string;
  /** `HH:MM`, or null when there is no fixed time. */
  startTime: string | null;
  capacity: number;
  isOpen: boolean;
  seatsBooked: number;
}

interface DeparturesSectionProps {
  tourId: string;
  departures: DepartureRow[];
  /** Live availability by start date, for the dates the calendar covers. */
  days: Record<string, DepartureDay>;
  today: string;
}

interface Draft {
  startDate: string;
  startTime: string;
  capacity: string;
}

const STATUS_BADGE: Record<DepartureSeats["status"], string> = {
  open: "badge-confirmed",
  limited: "badge-pending",
  full: "badge-cancelled",
  closed: "badge-secondary",
  past: "badge-completed",
  blocked: "badge-pending",
  outside: "badge-outline text-muted-foreground",
};

/** What is wrong with a draft before it is sent, by field. */
function draftProblems(draft: Draft): Record<string, string[]> {
  const problems: Record<string, string[]> = {};
  if (!draft.startDate) problems.startDate = ["Choose a date."];
  const capacity = parseWhole(draft.capacity);
  if (capacity === null || capacity < 1 || capacity > 999) problems.capacity = ["Use 1 to 999 seats."];
  return problems;
}

const toWire = (draft: Draft) => ({ startDate: draft.startDate, startTime: draft.startTime || null, capacity: parseWhole(draft.capacity) ?? 0 });

/** Runs `submit` when Enter is pressed in a field, instead of saving the whole tour. */
const onEnter = (submit: () => void) => (event: KeyboardEvent<HTMLDivElement>) => {
  if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
    event.preventDefault();
    submit();
  }
};

/**
 * Dates of a departure tour. Each change is saved on its own, straight away:
 * a departure is a record guests book against, not a draft field of the tour.
 */
export function DeparturesSection({ tourId, departures, days, today }: DeparturesSectionProps) {
  const [draft, setDraft] = useState<Draft>({ startDate: "", startTime: "", capacity: "" });
  const [draftErrors, setDraftErrors] = useState<Record<string, string[]> | undefined>(undefined);
  const [editing, setEditing] = useState<(Draft & { id: string }) | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string[]> | undefined>(undefined);
  const [toRemove, setToRemove] = useState<DepartureRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const ids = useId();

  const add = useAction(addDepartureAction, { success: "Departure added", toastError: false });
  const update = useAction(updateDepartureAction, { success: "Departure saved", toastError: false });
  const toggle = useAction(updateDepartureAction);
  const remove = useAction(removeDepartureAction, { success: "Departure removed", toastError: false });

  async function submitDraft() {
    const problems = draftProblems(draft);
    if (Object.keys(problems).length > 0) {
      setDraftErrors(problems);
      return;
    }
    setDraftErrors(undefined);
    const result = await add.run({ tourId, departure: toWire(draft) });
    if (result.ok) setDraft({ startDate: "", startTime: "", capacity: draft.capacity });
    else setDraftErrors(result.fieldErrors ?? { form: [result.error] });
  }

  async function submitEdit() {
    if (!editing) return;
    const problems = draftProblems(editing);
    if (Object.keys(problems).length > 0) {
      setEditErrors(problems);
      return;
    }
    setEditErrors(undefined);
    const result = await update.run({ id: editing.id, tourId, departure: toWire(editing) });
    if (result.ok) setEditing(null);
    else setEditErrors(result.fieldErrors ?? { form: [result.error] });
  }

  async function setOpen(departure: DepartureRow, isOpen: boolean) {
    setBusy(departure.id);
    const result = await toggle.run({ id: departure.id, tourId, departure: { isOpen } });
    setBusy(null);
    if (result.ok) toast.success(isOpen ? "Departure reopened for booking" : "Departure closed to new bookings");
  }

  async function confirmRemove() {
    if (!toRemove) return;
    const result = await remove.run({ id: toRemove.id, tourId });
    if (result.ok) setToRemove(null);
  }

  const upcoming = departures.filter((departure) => departure.startDate >= today);
  const past = departures.filter((departure) => departure.startDate < today);

  const row = (departure: DepartureRow) => {
    const seats = departureSeats(departure, days[departure.startDate], today);
    const isPast = departure.startDate < today;
    if (editing?.id === departure.id) {
      return (
        <li key={departure.id} className="p-4">
          <div role="group" aria-label={`Edit the departure on ${formatCalendarDate(departure.startDate)}`} className="flex flex-col gap-3" onKeyDown={onEnter(() => void submitEdit())}>
            <DraftFields idPrefix={`${ids}-edit`} draft={editing} errors={editErrors} min={today} onChange={(next) => setEditing({ ...editing, ...next })} />
            {firstError(editErrors, "form") ? (
              <p role="alert" className="field-error">
                {firstError(editErrors, "form")}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button type="button" className="btn btn-default btn-sm" disabled={update.pending} aria-busy={update.pending || undefined} onClick={() => void submitEdit()}>
                {update.pending ? <Spinner /> : null}
                Save departure
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        </li>
      );
    }
    return (
      <li key={departure.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <div className="min-w-0 flex-1 basis-48">
          <p className="font-semibold">
            {formatCalendarDate(departure.startDate)}
            {departure.startTime ? <span className="font-normal text-muted-foreground"> · {departure.startTime}</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {seats.taken} of {departure.capacity} seats taken
          </p>
          <div className="progress mt-2 h-1.5 max-w-48" role="progressbar" aria-label="Seats taken" aria-valuemin={0} aria-valuemax={departure.capacity} aria-valuenow={Math.min(seats.taken, departure.capacity)}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (seats.taken / departure.capacity) * 100)}%` }} />
          </div>
        </div>
        <span className={cn("badge", STATUS_BADGE[seats.status])}>{seats.label}</span>
        {isPast ? null : (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs font-semibold">
              <button
                type="button"
                role="switch"
                className="switch"
                aria-checked={departure.isOpen}
                aria-label={`Open for booking: ${formatCalendarDate(departure.startDate)}`}
                disabled={busy === departure.id}
                onClick={() => void setOpen(departure, !departure.isOpen)}
              >
                <span className="switch-thumb" />
              </button>
              Bookable
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              aria-label={`Edit the departure on ${formatCalendarDate(departure.startDate)}`}
              onClick={() => {
                setEditErrors(undefined);
                setEditing({ id: departure.id, startDate: departure.startDate, startTime: departure.startTime ?? "", capacity: String(departure.capacity) });
              }}
            >
              <Pencil aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm text-destructive hover:text-destructive"
              aria-label={`Remove the departure on ${formatCalendarDate(departure.startDate)}`}
              onClick={() => {
                remove.reset();
                setToRemove(departure);
              }}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      {upcoming.length === 0 ? (
        <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
          No upcoming departures. Add the first date below; a departure tour needs at least one before it can be published.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">{upcoming.map(row)}</ul>
      )}

      <div role="group" aria-label="Add a departure" className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4" onKeyDown={onEnter(() => void submitDraft())}>
        <p className="label">Add a departure</p>
        <DraftFields idPrefix={`${ids}-new`} draft={draft} errors={draftErrors} min={today} onChange={(next) => setDraft({ ...draft, ...next })} />
        {firstError(draftErrors, "form") ?? firstError(draftErrors, "kind") ? (
          <p role="alert" className="field-error">
            {firstError(draftErrors, "form") ?? firstError(draftErrors, "kind")}
          </p>
        ) : null}
        <div>
          <button type="button" className="btn btn-outline" disabled={add.pending} aria-busy={add.pending || undefined} onClick={() => void submitDraft()}>
            {add.pending ? <Spinner /> : <Plus aria-hidden="true" />}
            Add departure
          </button>
        </div>
      </div>

      {past.length > 0 ? (
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
            Past departures <span className="font-normal text-muted-foreground">· {past.length}</span>
          </summary>
          <ul className="divide-y border-t">{[...past].reverse().map(row)}</ul>
        </details>
      ) : null}

      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(open) => (open ? undefined : setToRemove(null))}
        title={toRemove ? `Remove the departure on ${formatCalendarDate(toRemove.startDate, { weekday: false })}?` : "Remove this departure?"}
        description={
          <>
            <p>Guests will no longer be able to book this date. This can’t be undone.</p>
            {remove.error ? (
              <p role="alert" className="alert alert-destructive mt-3">
                {remove.error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Remove departure"
        cancelLabel="Keep it"
        destructive
        pending={remove.pending}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}

interface DraftFieldsProps {
  idPrefix: string;
  draft: Draft;
  errors: Record<string, string[]> | undefined;
  min: string;
  onChange: (patch: Partial<Draft>) => void;
}

function DraftFields({ idPrefix, draft, errors, min, onChange }: DraftFieldsProps) {
  const field = (name: keyof Draft) => ({
    id: `${idPrefix}-${name}`,
    "aria-invalid": Boolean(firstError(errors, name)),
    "aria-describedby": firstError(errors, name) ? `${idPrefix}-${name}-error` : undefined,
  });
  const problem = (name: keyof Draft) =>
    firstError(errors, name) ? (
      <span id={`${idPrefix}-${name}-error`} role="alert" className="field-error">
        {firstError(errors, name)}
      </span>
    ) : null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${idPrefix}-startDate`} className="label">
          Date
        </label>
        <input {...field("startDate")} type="date" className="input" min={min} value={draft.startDate} onChange={(event) => onChange({ startDate: event.target.value })} />
        {problem("startDate")}
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${idPrefix}-startTime`} className="label">
          Start time <span className="ml-1.5 font-normal text-muted-foreground">optional</span>
        </label>
        <input {...field("startTime")} type="time" className="input" value={draft.startTime} onChange={(event) => onChange({ startTime: event.target.value })} />
        {problem("startTime")}
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${idPrefix}-capacity`} className="label">
          Seats
        </label>
        <input {...field("capacity")} className="input" inputMode="numeric" placeholder="e.g. 12" value={draft.capacity} onChange={(event) => onChange({ capacity: event.target.value })} />
        {problem("capacity")}
      </div>
    </div>
  );
}
