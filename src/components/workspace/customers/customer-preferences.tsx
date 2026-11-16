"use client";

import { useId, useState } from "react";
import { setMarketingOptInAction, setPreferredContactAction } from "@/app/workspace/customers/actions";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { CONTACT_METHOD_LABELS, type ContactMethod } from "@/lib/booking-display";

const METHODS = Object.keys(CONTACT_METHOD_LABELS) as ContactMethod[];

interface CustomerPreferencesProps {
  customerId: string;
  preferredContact: ContactMethod;
  marketingOptIn: boolean;
}

/**
 * How the customer wants to be reached. Each control saves on its own the
 * moment it changes, and steps back if the save fails.
 */
export function CustomerPreferences({ customerId, preferredContact, marketingOptIn }: CustomerPreferencesProps) {
  const selectId = useId();
  const switchLabelId = useId();
  const switchHintId = useId();

  const [method, setMethod] = useState(preferredContact);
  const [optIn, setOptIn] = useState(marketingOptIn);

  const contact = useAction(setPreferredContactAction, { success: "Contact preference saved", toastError: false });
  const marketing = useAction(setMarketingOptInAction, { success: "Marketing preference saved", toastError: false });

  // A save in flight is not interrupted; the control stays live so nothing flickers.
  async function changeMethod(next: ContactMethod) {
    if (contact.pending || next === method) return;
    const previous = method;
    setMethod(next);
    const result = await contact.run({ id: customerId, method: next });
    if (!result.ok) setMethod(previous);
  }

  async function toggleOptIn() {
    if (marketing.pending) return;
    const next = !optIn;
    setOptIn(next);
    const result = await marketing.run({ id: customerId, optIn: next });
    if (!result.ok) setOptIn(!next);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor={selectId} className="label">
          Preferred contact
        </label>
        <div className="flex items-center gap-2">
          <select
            id={selectId}
            className="select"
            value={method}
            aria-busy={contact.pending || undefined}
            aria-invalid={Boolean(contact.error)}
            aria-describedby={contact.error ? `${selectId}-error` : undefined}
            onChange={(event) => {
              const next = METHODS.find((option) => option === event.target.value);
              if (next) void changeMethod(next);
            }}
          >
            {METHODS.map((option) => (
              <option key={option} value={option}>
                {CONTACT_METHOD_LABELS[option]}
              </option>
            ))}
          </select>
          {contact.pending ? <Spinner className="size-4 shrink-0 text-muted-foreground" /> : null}
        </div>
        {contact.error ? (
          <span id={`${selectId}-error`} role="alert" className="field-error">
            {contact.error}
          </span>
        ) : null}
      </div>

      <div className="separator" />

      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p id={switchLabelId} className="label">
              Marketing messages
            </p>
            <p id={switchHintId} className="field-hint mt-1.5 leading-relaxed">
              {optIn ? "This customer agreed to receive offers and news." : "This customer has not agreed to receive offers and news."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            className="switch mt-0.5"
            aria-checked={optIn}
            aria-labelledby={switchLabelId}
            aria-describedby={switchHintId}
            aria-busy={marketing.pending || undefined}
            onClick={() => void toggleOptIn()}
          >
            <span className="switch-thumb" />
          </button>
        </div>
        {marketing.error ? (
          <span role="alert" className="field-error">
            {marketing.error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
