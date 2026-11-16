"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nextAvailable, type DayInfo } from "@/lib/booking-form";
import { addMonths, monthEnd, monthOf, monthStart, quarterWindow } from "@/lib/calendar";
import { eachDate } from "@/lib/dates";
import type { AvailabilityResponse } from "./types";

type MonthState = "ready" | "error";

interface Store {
  slug: string;
  days: Record<string, DayInfo>;
  months: Record<string, MonthState>;
}

const emptyStore = (slug: string): Store => ({ slug, days: {}, months: {} });

async function fetchWindow(slug: string, from: string, to: string): Promise<AvailabilityResponse> {
  const query = new URLSearchParams({ tour: slug, from, to });
  const response = await fetch(`/api/availability?${query.toString()}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`availability ${response.status}`);
  return (await response.json()) as AvailabilityResponse;
}

export interface Availability {
  /** Every date loaded so far, by `YYYY-MM-DD`. */
  days: Record<string, DayInfo>;
  /** State of the month on screen. */
  status: "loading" | "ready" | "error";
  /** Tries the failed months again. */
  retry: () => void;
  /** Forgets everything and loads afresh, e.g. after a slot was lost. */
  reload: () => void;
  /** The next bookable dates after `after`, looking as far as the booking horizon. */
  findNext: (after: string, limit: number, exclude?: string) => Promise<string[]>;
}

/**
 * Live availability of one tour, loaded a quarter at a time from
 * `/api/availability` and kept while the tour stays selected. Three
 * consecutive months are the most the endpoint answers in one call.
 */
export function useAvailability(slug: string, month: string, bounds: { minMonth: string; maxMonth: string }): Availability {
  const { minMonth, maxMonth } = bounds;
  const [store, setStore] = useState<Store>(() => emptyStore(slug));
  // A store for another tour is simply not this tour's data.
  const current = useMemo(() => (store.slug === slug ? store : emptyStore(slug)), [store, slug]);

  const inflight = useRef(new Set<string>());
  const live = useRef({ slug, store: current });
  useEffect(() => {
    live.current = { slug, store: current };
  }, [slug, current]);

  /** Loads a run of up to three consecutive months and merges it in. */
  const load = useCallback(async (forSlug: string, months: string[]): Promise<DayInfo[] | null> => {
    const keys = months.map((entry) => `${forSlug}|${entry}`);
    for (const key of keys) inflight.current.add(key);
    try {
      const data = await fetchWindow(forSlug, monthStart(months[0]!), monthEnd(months.at(-1)!));
      // An answer for a tour the visitor has already left is dropped.
      if (live.current.slug === forSlug) {
        setStore((previous) => {
          const base = previous.slug === forSlug ? previous : emptyStore(forSlug);
          const days = { ...base.days };
          for (const day of data.days) days[day.date] = day;
          const state = { ...base.months };
          for (const entry of months) state[entry] = "ready";
          return { slug: forSlug, days, months: state };
        });
      }
      return data.days;
    } catch {
      if (live.current.slug === forSlug) {
        setStore((previous) => {
          const base = previous.slug === forSlug ? previous : emptyStore(forSlug);
          const state = { ...base.months };
          for (const entry of months) if (state[entry] !== "ready") state[entry] = "error";
          return { ...base, months: state };
        });
      }
      return null;
    } finally {
      for (const key of keys) inflight.current.delete(key);
    }
  }, []);

  // Keep the month on screen and the two after it loaded.
  useEffect(() => {
    const wanted = quarterWindow(month).months.filter((entry) => entry >= minMonth && entry <= maxMonth);
    const missing = wanted.filter((entry) => current.months[entry] === undefined && !inflight.current.has(`${slug}|${entry}`));
    if (missing.length === 0) return;
    const run = wanted.slice(wanted.indexOf(missing[0]!), wanted.indexOf(missing.at(-1)!) + 1);
    void load(slug, run);
  }, [slug, month, minMonth, maxMonth, current, load]);

  const retry = useCallback(() => {
    setStore((previous) => ({ ...previous, months: Object.fromEntries(Object.entries(previous.months).filter(([, state]) => state === "ready")) }));
  }, []);

  const reload = useCallback(() => setStore(emptyStore(live.current.slug)), []);

  const findNext = useCallback(
    async (after: string, limit: number, exclude?: string): Promise<string[]> => {
      const forSlug = live.current.slug;
      const found: string[] = [];
      let start = monthOf(after);
      // Nine quarters cover the longest booking horizon a business can set.
      for (let round = 0; round < 9 && found.length < limit && start <= maxMonth; round += 1) {
        const months = quarterWindow(start).months.filter((entry) => entry <= maxMonth);
        const known = live.current.slug === forSlug ? live.current.store : emptyStore(forSlug);
        let days: DayInfo[] | null;
        if (months.every((entry) => known.months[entry] === "ready")) {
          days = eachDate(monthStart(months[0]!), monthEnd(months.at(-1)!))
            .map((date) => known.days[date])
            .filter((day): day is DayInfo => day !== undefined);
        } else {
          days = await load(forSlug, months);
        }
        if (!days) break;
        found.push(...nextAvailable(days, after, limit - found.length, exclude));
        start = addMonths(start, 3);
      }
      return found;
    },
    [maxMonth, load],
  );

  const monthState = current.months[month];
  return { days: current.days, status: monthState ?? "loading", retry, reload, findNext };
}
