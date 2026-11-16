"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { updateBookingRulesAction } from "@/app/workspace/settings/actions";
import { Field, FormError } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import { BOOKING_LIMITS, cleanPrefix, describeDaysOff, holdText, horizonText, noticeText, referenceExample, toggleWeekday, WEEKDAYS } from "./booking-rules";
import { errorFor, hasFieldError } from "./errors";
import { SaveBar, useUnsavedChanges } from "./save-bar";

const whole = (label: string, { min, max }: { min: number; max: number }) =>
  z
    .number(`Enter the ${label} as a number.`)
    .int("Use a whole number.")
    .min(min, `Use at least ${min}.`)
    .max(max, `Use at most ${max}.`);

// Immediate feedback with the same limits the server enforces.
const rulesSchema = z.object({
  holdHours: whole("hold time", BOOKING_LIMITS.holdHours),
  horizonDays: whole("booking window", BOOKING_LIMITS.horizonDays),
  minNoticeDays: whole("notice", BOOKING_LIMITS.minNoticeDays),
  weeklyDaysOff: z.array(z.number()).max(BOOKING_LIMITS.maxDaysOff, "Keep at least one day of the week open."),
  referencePrefix: z.string().regex(/^[A-Z]{2,4}$/, "Use two to four letters."),
});
export type BookingRulesValues = z.infer<typeof rulesSchema>;
const FIELDS = Object.keys(rulesSchema.shape);

/** When and how far ahead people can book, and how their references look. */
export function BookingRulesForm({ initial }: { initial: BookingRulesValues }) {
  const form = useForm<BookingRulesValues>({ resolver: zodResolver(rulesSchema), defaultValues: initial });
  const { errors, isDirty } = form.formState;
  const { run, pending, error, fieldErrors } = useAction(updateBookingRulesAction, {
    success: "Booking rules saved",
    toastError: false,
    onSuccess: (saved) => form.reset(saved),
  });
  useUnsavedChanges(isDirty);

  const message = (name: keyof BookingRulesValues) => errors[name]?.message ?? errorFor(fieldErrors, name);
  const formLevel = error && !hasFieldError(fieldErrors, FIELDS) ? error : null;
  const [holdHours, horizonDays, minNoticeDays, prefix, daysOff] = useWatch({
    control: form.control,
    name: ["holdHours", "horizonDays", "minNoticeDays", "referencePrefix", "weeklyDaysOff"],
  });
  const example = referenceExample(prefix);

  return (
    <form onSubmit={form.handleSubmit((values) => run(values))} noValidate className="flex max-w-4xl flex-col gap-6">
      <FormError message={formLevel} />
      <section className="card" aria-labelledby="rules-timing">
        <div className="card-header">
          <h2 id="rules-timing" className="card-title">
            Booking window
          </h2>
          <p className="card-description">Applies to every tour on your website. Bookings already made keep their dates.</p>
        </div>
        <div className="card-content grid gap-4 sm:grid-cols-3">
          <Field label="Hold a request for" note="hours" hint={holdText(holdHours)} error={message("holdHours")}>
            {(control) => (
              <input
                {...control}
                {...form.register("holdHours", { valueAsNumber: true })}
                className="input"
                type="number"
                inputMode="numeric"
                min={BOOKING_LIMITS.holdHours.min}
                max={BOOKING_LIMITS.holdHours.max}
              />
            )}
          </Field>
          <Field label="Minimum notice" note="days" hint={noticeText(minNoticeDays)} error={message("minNoticeDays")}>
            {(control) => (
              <input
                {...control}
                {...form.register("minNoticeDays", { valueAsNumber: true })}
                className="input"
                type="number"
                inputMode="numeric"
                min={BOOKING_LIMITS.minNoticeDays.min}
                max={BOOKING_LIMITS.minNoticeDays.max}
              />
            )}
          </Field>
          <Field label="Book up to" note="days ahead" hint={horizonText(horizonDays)} error={message("horizonDays")}>
            {(control) => (
              <input
                {...control}
                {...form.register("horizonDays", { valueAsNumber: true })}
                className="input"
                type="number"
                inputMode="numeric"
                min={BOOKING_LIMITS.horizonDays.min}
                max={BOOKING_LIMITS.horizonDays.max}
              />
            )}
          </Field>
        </div>
      </section>

      <section className="card" aria-labelledby="rules-days-off">
        <div className="card-header">
          <h2 id="rules-days-off" className="card-title">
            Weekly days off
          </h2>
          <p className="card-description">No tour can be booked to start on these days.</p>
        </div>
        <div className="card-content flex flex-col gap-3">
          <Controller
            control={form.control}
            name="weeklyDaysOff"
            render={({ field }) => (
              <div role="group" aria-labelledby="rules-days-off" className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => {
                  const off = field.value.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      aria-pressed={off}
                      aria-label={day.long}
                      onClick={() => field.onChange(toggleWeekday(field.value, day.value))}
                      className="chip min-w-14 justify-center"
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            )}
          />
          <p className="field-hint" aria-live="polite">
            Days off: {describeDaysOff(daysOff)}.
          </p>
          {message("weeklyDaysOff") ? (
            <span role="alert" className="field-error">
              {message("weeklyDaysOff")}
            </span>
          ) : null}
        </div>
      </section>

      <section className="card" aria-labelledby="rules-reference">
        <div className="card-header">
          <h2 id="rules-reference" className="card-title">
            Booking references
          </h2>
          <p className="card-description">Every booking gets a reference that starts with these letters. Existing references do not change.</p>
        </div>
        <div className="card-content grid items-start gap-4 sm:grid-cols-2">
          <Field label="Reference prefix" hint="Two to four letters, for example your initials." error={message("referencePrefix")}>
            {(control) => {
              const registration = form.register("referencePrefix");
              return (
                <input
                  {...control}
                  {...registration}
                  onChange={(event) => {
                    event.target.value = cleanPrefix(event.target.value);
                    return registration.onChange(event);
                  }}
                  className="input font-semibold uppercase tracking-[0.12em]"
                  maxLength={4}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              );
            }}
          </Field>
          <div className="rounded-lg border bg-muted/40 p-4" aria-live="polite">
            <p className="text-xs text-muted-foreground">A booking reference will look like</p>
            <p className="mt-1 font-mono text-lg font-semibold tracking-wide">{example ?? "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">Then three letters from the tour’s name and a number.</p>
          </div>
        </div>
      </section>

      <SaveBar dirty={isDirty} pending={pending} onDiscard={() => form.reset(initial)} saveLabel="Save booking rules" savedMessage="Your booking rules are saved." />
    </form>
  );
}
