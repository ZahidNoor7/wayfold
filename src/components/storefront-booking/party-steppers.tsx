"use client";

import { Minus, Plus } from "lucide-react";
import { stepParty, stepperState, type Party, type PartyLimits } from "@/lib/booking-form";
import { cn } from "@/lib/utils";

interface PartySteppersProps {
  party: Party;
  limits: PartyLimits;
  onChange: (party: Party) => void;
  /** Small line under "Adults", e.g. "$690 each". */
  adultNote?: string;
  /** Small line under "Children", e.g. "Aged 11 or under · $345". */
  childNote?: string;
  /** `card`: one bordered box with a divider. `rows`: full-width rows with rules, as in the tour page card. */
  variant?: "card" | "rows";
  className?: string;
}

/**
 * Adults and children counters. A button that would break the tour's group
 * limits is disabled rather than silently ignored, and the count is announced
 * as it changes.
 */
export function PartySteppers({ party, limits, onChange, adultNote, childNote, variant = "card", className }: PartySteppersProps) {
  const state = stepperState(party, limits);
  const rows = [
    { field: "adults" as const, label: "Adults", note: adultNote, value: party.adults, canAdd: state.canAddAdult, canRemove: state.canRemoveAdult, fewer: "Fewer adults", more: "More adults" },
    { field: "children" as const, label: "Children", note: childNote, value: party.children, canAdd: state.canAddChild, canRemove: state.canRemoveChild, fewer: "Fewer children", more: "More children" },
  ];

  return (
    <div className={cn(variant === "card" ? "flex flex-col divide-y rounded-xl border" : "flex flex-col divide-y border-y", className)}>
      {rows.map((row) => (
        <div key={row.field} className={cn("flex items-center justify-between gap-3", variant === "card" ? "p-3" : "py-3")}>
          <span>
            <span className={cn("block font-semibold", variant === "card" && "text-sm")}>{row.label}</span>
            {row.note ? <span className={cn("text-muted-foreground", variant === "card" ? "text-xs" : "text-[13px]")}>{row.note}</span> : null}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-outline btn-icon rounded-full"
              aria-label={row.fewer}
              disabled={!row.canRemove}
              onClick={() => onChange(stepParty(party, row.field, -1, limits))}
            >
              <Minus aria-hidden="true" />
            </button>
            <span className="w-6 text-center font-bold tabular-nums" aria-live="polite" aria-atomic="true">
              <span className="sr-only">{row.label}: </span>
              {row.value}
            </span>
            <button
              type="button"
              className="btn btn-outline btn-icon rounded-full"
              aria-label={row.more}
              disabled={!row.canAdd}
              onClick={() => onChange(stepParty(party, row.field, 1, limits))}
            >
              <Plus aria-hidden="true" />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
