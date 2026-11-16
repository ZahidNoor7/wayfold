"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

export interface ItineraryItem {
  dayNumber: number;
  title: string;
  location: string;
  description: string;
  meta: string;
}

/**
 * Day-by-day timeline. Days open independently (several can be open), the
 * first is open to begin with, and one control opens or closes them all.
 */
export function TourItinerary({ days, headingId }: { days: ItineraryItem[]; headingId: string }) {
  const baseId = useId();
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set(days.length > 0 ? [0] : []));
  const allOpen = open.size === days.length;

  const toggle = (index: number) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={headingId} className="font-display text-4xl font-medium text-primary">
          Day-by-day itinerary
        </h2>
        {days.length > 1 ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(allOpen ? new Set() : new Set(days.map((_, index) => index)))}>
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        ) : null}
      </div>
      <ol className="relative">
        {days.map((day, index) => {
          const expanded = open.has(index);
          const panelId = `${baseId}-day-${index}`;
          return (
            <li key={`${day.dayNumber}-${index}`} className="flex gap-5">
              <div className="flex shrink-0 flex-col items-center" aria-hidden="true">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-highlight bg-card font-display text-2xl font-semibold text-primary">
                  {day.dayNumber}
                </span>
                <span className="mt-1 w-px flex-1 bg-border" />
              </div>
              <div className="min-w-0 flex-1 pb-6">
                <h3>
                  <button type="button" className="accordion-trigger !py-2" aria-expanded={expanded} aria-controls={panelId} onClick={() => toggle(index)}>
                    <span className="min-w-0">
                      <span className="eyebrow block">
                        Day {day.dayNumber}
                        {day.location ? ` · ${day.location}` : ""}
                      </span>
                      <span className="mt-1 block font-display text-[26px] font-medium leading-tight text-primary">{day.title}</span>
                    </span>
                    <ChevronDown aria-hidden="true" />
                  </button>
                </h3>
                <div id={panelId} hidden={!expanded} className={expanded ? "animate-fade-in" : undefined}>
                  {day.description ? <p className="mb-2 mt-1 whitespace-pre-line text-base leading-relaxed text-foreground/85">{day.description}</p> : null}
                  {day.meta ? <p className="text-[13px] text-muted-foreground">{day.meta}</p> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** Questions and answers. One answer is open at a time; pressing the open one closes it. */
export function TourFaq({ items }: { items: Array<{ question: string; answer: string }> }) {
  const baseId = useId();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div>
      {items.map((item, index) => {
        const expanded = open === index;
        const panelId = `${baseId}-faq-${index}`;
        return (
          <div key={`${item.question}-${index}`} className="border-b">
            <h3>
              <button
                type="button"
                className="accordion-trigger text-[17px]"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setOpen(expanded ? null : index)}
              >
                {item.question}
                <ChevronDown aria-hidden="true" />
              </button>
            </h3>
            <div id={panelId} hidden={!expanded}>
              <p className="max-w-2xl animate-fade-in whitespace-pre-line pb-5 text-[15px] leading-relaxed text-muted-foreground">{item.answer}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
