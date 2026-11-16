"use client";

import { Search, SlidersHorizontal, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useOptimistic, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { BottomSheet, Panel, Spinner } from "@/components/overlays";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_BADGES,
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  clashHeadline,
  pageCount,
  pageSummary,
  type BookingStatus,
  type PaymentStatus,
} from "@/lib/booking-display";
import { cn } from "@/lib/utils";
import { BookingPanelContent, BookingPanelMissing, BookingPanelSkeleton, type PanelPermissions } from "./booking-panel";
import {
  BOOKINGS_PAGE_SIZE,
  BOOKING_SORTS,
  BOOKING_SORT_LABELS,
  MAX_SEARCH_LENGTH,
  bookingsHref,
  clearedHref,
  filterHref,
  isFiltered,
  secondaryFilterCount,
  type BookingSort,
  type BookingsView,
} from "./filters";
import type { BookingDetailView, BookingRowView } from "./view-models";

type Navigate = (href: string, mode?: "push" | "replace") => void;

interface BookingsScreenProps {
  view: BookingsView;
  rows: BookingRowView[];
  /** Rows matching the filters, across every page. */
  total: number;
  counts: Record<BookingStatus | "all", number>;
  tours: { id: string; title: string }[];
  /** Bookings in the workspace that currently clash with another. */
  clashCount: number;
  detail: BookingDetailView | null;
  permissions: PanelPermissions;
}

const TABS: { status: BookingStatus | undefined; label: string; key: BookingStatus | "all" }[] = [
  { status: undefined, label: "All", key: "all" },
  ...BOOKING_STATUSES.map((status) => ({ status, label: BOOKING_STATUS_LABELS[status], key: status })),
];

function StatusTabs({ view, counts, navigate }: { view: BookingsView; counts: BookingsScreenProps["counts"]; navigate: Navigate }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]?.focus();
  }

  return (
    <div role="tablist" aria-label="Status" className="tabs-list no-scrollbar max-w-full justify-start overflow-x-auto" onKeyDown={onKeyDown}>
      {TABS.map((tab) => {
        const selected = view.status === tab.status;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls="bookings-list"
            tabIndex={selected ? 0 : -1}
            className="tabs-trigger"
            onClick={() => navigate(filterHref(view, { status: tab.status }))}
          >
            {tab.label} <span className="rounded-full bg-muted-foreground/15 px-1.5 text-xs">{counts[tab.key]}</span>
          </button>
        );
      })}
    </div>
  );
}

function SearchBox({ view, navigate, pending }: { view: BookingsView; navigate: Navigate; pending: boolean }) {
  const urlQuery = view.q ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);
  const [pushedQuery, setPushedQuery] = useState(urlQuery);

  // The URL changed under the box (back button, "Clear filters"): adopt it,
  // unless it is simply our own last search arriving.
  if (urlQuery !== seenUrlQuery) {
    setSeenUrlQuery(urlQuery);
    if (urlQuery !== pushedQuery) {
      setQuery(urlQuery);
      setPushedQuery(urlQuery);
    }
  }

  const search = useCallback(
    (value: string) => {
      const next = value.trim().slice(0, MAX_SEARCH_LENGTH);
      setPushedQuery(next);
      // Typing replaces the entry so the back button leaves the search in one step.
      navigate(filterHref(view, { q: next || undefined }), "replace");
    },
    [navigate, view],
  );

  useEffect(() => {
    if (query.trim().slice(0, MAX_SEARCH_LENGTH) === pushedQuery) return;
    const timer = window.setTimeout(() => search(query), 300);
    return () => window.clearTimeout(timer);
  }, [query, pushedQuery, search]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim().slice(0, MAX_SEARCH_LENGTH) !== pushedQuery) search(query);
  }

  return (
    <form role="search" onSubmit={submit} className="relative flex-1 md:w-72 md:flex-none">
      <label htmlFor="booking-search" className="sr-only">
        Search bookings
      </label>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
      <input
        id="booking-search"
        className="input pl-9 pr-9"
        type="search"
        placeholder="Search name, reference, e-mail, tour…"
        autoComplete="off"
        maxLength={MAX_SEARCH_LENGTH}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {pending ? <Spinner className="pointer-events-none absolute right-3 top-3.5 size-4 text-muted-foreground" /> : null}
    </form>
  );
}

function TourSelect({ view, tours, navigate, className }: { view: BookingsView; tours: BookingsScreenProps["tours"]; navigate: Navigate; className?: string }) {
  return (
    <select
      className={cn("select", className)}
      aria-label="Filter by tour"
      value={view.tour ?? ""}
      onChange={(event) => navigate(filterHref(view, { tour: event.target.value || undefined }))}
    >
      <option value="">All tours</option>
      {tours.map((tour) => (
        <option key={tour.id} value={tour.id}>
          {tour.title}
        </option>
      ))}
    </select>
  );
}

const SMALL_LABEL = "text-xs font-semibold text-muted-foreground";

/** Date range, payment and sort. Inline on wide screens, inside the sheet on phones. */
function SecondaryFilters({ view, navigate, stacked }: { view: BookingsView; navigate: Navigate; stacked?: boolean }) {
  const id = useId();
  const field = stacked ? "flex flex-col gap-1.5" : "flex w-40 flex-col gap-1.5";
  return (
    <>
      <div className={field}>
        <label htmlFor={`${id}-from`} className={SMALL_LABEL}>
          Tour date from
        </label>
        <input
          id={`${id}-from`}
          type="date"
          className="input"
          value={view.from ?? ""}
          max={view.to}
          onChange={(event) => navigate(filterHref(view, { from: event.target.value || undefined }))}
        />
      </div>
      <div className={field}>
        <label htmlFor={`${id}-to`} className={SMALL_LABEL}>
          Tour date to
        </label>
        <input
          id={`${id}-to`}
          type="date"
          className="input"
          value={view.to ?? ""}
          min={view.from}
          onChange={(event) => navigate(filterHref(view, { to: event.target.value || undefined }))}
        />
      </div>
      <div className={field}>
        <label htmlFor={`${id}-payment`} className={SMALL_LABEL}>
          Payment
        </label>
        <select
          id={`${id}-payment`}
          className="select"
          value={view.payment ?? ""}
          onChange={(event) => navigate(filterHref(view, { payment: (event.target.value || undefined) as PaymentStatus | undefined }))}
        >
          <option value="">Any payment status</option>
          {PAYMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PAYMENT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>
      <div className={stacked ? field : "flex w-56 flex-col gap-1.5"}>
        <label htmlFor={`${id}-sort`} className={SMALL_LABEL}>
          Sort by
        </label>
        <select id={`${id}-sort`} className="select" value={view.sort} onChange={(event) => navigate(filterHref(view, { sort: event.target.value as BookingSort }))}>
          {BOOKING_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {BOOKING_SORT_LABELS[sort]}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function ClashFlag({ clashes, compact }: { clashes: string[]; compact?: boolean }) {
  if (clashes.length === 0) return null;
  return (
    <span className="badge badge-cancelled" title={clashes.join(" · ")}>
      <TriangleAlert aria-hidden="true" className="size-3" />
      {compact ? <span className="sr-only">Scheduling conflict</span> : "Clash"}
    </span>
  );
}

export function BookingsScreen({ view, rows, total, counts, tours, clashCount, detail, permissions }: BookingsScreenProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const urlBooking = view.booking ?? null;
  // Pressing a row opens the panel at once; the URL and the full record follow.
  const [openId, setOpenId] = useOptimistic(urlBooking);
  const [lastDetail, setLastDetail] = useState(detail);
  if (detail && detail !== lastDetail) setLastDetail(detail);

  const navigate = useCallback<Navigate>(
    (href, mode = "push") => {
      startTransition(() => {
        if (mode === "replace") router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
      });
    },
    [router],
  );

  function openBooking(id: string) {
    startTransition(() => {
      setOpenId(id);
      router.push(bookingsHref(view, { booking: id }), { scroll: false });
    });
  }

  function closeBooking() {
    startTransition(() => {
      setOpenId(null);
      router.push(bookingsHref(view, { booking: undefined }), { scroll: false });
    });
  }

  const pages = pageCount(total, BOOKINGS_PAGE_SIZE);
  const filterCount = secondaryFilterCount(view);
  const filtered = isFiltered(view);

  // While the panel slides away, keep showing what it held.
  const shown = openId === null ? lastDetail : detail && detail.id === openId ? detail : null;
  const openRow = openId ? (rows.find((row) => row.id === openId) ?? null) : null;
  const missing = openId !== null && !shown && !pending && openId === urlBooking;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <StatusTabs view={view} counts={counts} navigate={navigate} />
        <div className="flex gap-2">
          <SearchBox view={view} navigate={navigate} pending={pending} />
          <TourSelect view={view} tours={tours} navigate={navigate} className="hidden w-44 md:block" />
          <button type="button" className="btn btn-outline shrink-0 md:hidden" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal aria-hidden="true" />
            Filters
            {filterCount > 0 ? (
              <span className="badge badge-highlight">
                {filterCount}
                <span className="sr-only"> active</span>
              </span>
            ) : null}
          </button>
        </div>
      </div>

      <div className="mb-4 hidden flex-wrap items-end gap-3 md:flex">
        <SecondaryFilters view={view} navigate={navigate} />
        {filtered ? (
          <button type="button" className="btn btn-ghost" onClick={() => navigate(clearedHref(view))}>
            Clear filters
          </button>
        ) : null}
      </div>

      <BottomSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="Filters"
        description="Narrow the list by tour, date, payment or order."
        footer={
          <div className="flex gap-2">
            {filtered ? (
              <button
                type="button"
                className="btn btn-outline flex-1"
                onClick={() => {
                  navigate(clearedHref(view));
                  setFiltersOpen(false);
                }}
              >
                Clear filters
              </button>
            ) : null}
            <button type="button" className="btn btn-default flex-1" onClick={() => setFiltersOpen(false)}>
              Show {total} {total === 1 ? "booking" : "bookings"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={SMALL_LABEL}>Tour</span>
            <TourSelect view={view} tours={tours} navigate={navigate} />
          </div>
          <SecondaryFilters view={view} navigate={navigate} stacked />
        </div>
      </BottomSheet>

      {clashCount > 0 || view.clash ? (
        <div role={clashCount > 0 ? "alert" : undefined} className={cn("alert mb-4 flex flex-wrap items-center justify-between gap-3", clashCount > 0 && "alert-destructive")}>
          <span className="flex items-center gap-2 font-semibold">
            <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
            {clashCount > 0
              ? `${clashHeadline(clashCount)} — overlapping or over-capacity requests for the same date.`
              : "No scheduling conflicts right now."}
          </span>
          <button type="button" aria-pressed={view.clash} className="btn btn-outline btn-sm bg-background text-foreground" onClick={() => navigate(filterHref(view, { clash: !view.clash }))}>
            {view.clash ? "Show all bookings" : "Show conflicts only"}
          </button>
        </div>
      ) : null}

      <div id="bookings-list" role="tabpanel" aria-label="Bookings" aria-busy={pending || undefined} className={cn("card overflow-hidden transition-opacity", pending && "opacity-70")}>
        {rows.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="table min-w-[860px]">
                <thead>
                  <tr>
                    <th scope="col" className="pl-6">
                      Reference
                    </th>
                    <th scope="col">Guest</th>
                    <th scope="col">Tour</th>
                    <th scope="col">Tour date</th>
                    <th scope="col">Guests</th>
                    <th scope="col">Total</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="pr-6">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="cursor-pointer" onClick={() => openBooking(row.id)}>
                      <td className="pl-6 font-bold text-primary">{row.reference}</td>
                      <td>
                        <span className="block font-semibold">{row.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {row.country ? `${row.country} · ` : ""}requested {row.requested}
                        </span>
                      </td>
                      <td className="text-muted-foreground">{row.tourTitle}</td>
                      <td className="whitespace-nowrap">
                        {row.date}
                        {row.time ? <span className="text-muted-foreground"> · {row.time}</span> : null}
                      </td>
                      <td>{row.guests}</td>
                      <td className="font-semibold">
                        {row.total}
                        {row.base ? <span className="block text-xs font-normal text-muted-foreground line-through">{row.base}</span> : null}
                      </td>
                      <td>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className={BOOKING_STATUS_BADGES[row.status]}>{row.statusLabel}</span>
                          <ClashFlag clashes={row.clashes} />
                        </span>
                      </td>
                      <td className="pr-6 text-right">
                        <button
                          type="button"
                          aria-label={`Open ${row.reference}`}
                          className="btn btn-outline btn-sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            openBooking(row.id);
                          }}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y md:hidden">
              {rows.map((row) => (
                <li key={row.id}>
                  <button type="button" className="flex w-full flex-col gap-1.5 p-4 text-left hover:bg-muted/50 active:bg-muted" onClick={() => openBooking(row.id)}>
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-bold">{row.name}</span>
                      <span className="flex shrink-0 gap-1">
                        <ClashFlag clashes={row.clashes} compact />
                        <span className={BOOKING_STATUS_BADGES[row.status]}>{row.statusLabel}</span>
                      </span>
                    </span>
                    <span className="text-sm text-muted-foreground">{row.tourTitle}</span>
                    <span className="flex w-full justify-between gap-3 text-[13px]">
                      <span>
                        {row.date}
                        {row.time ? ` · ${row.time}` : ""} · {row.guests}
                      </span>
                      <span className="font-semibold">{row.total}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="p-14 text-center">
            <p className="font-bold">No bookings match</p>
            <p className="text-sm text-muted-foreground">Try another status, tour, date range or search term.</p>
            {filtered ? (
              <button type="button" className="btn btn-outline btn-sm mt-4" onClick={() => navigate(clearedHref(view))}>
                Clear filters
              </button>
            ) : null}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-[13px] text-muted-foreground sm:px-6">
          <span>
            {pageSummary(view.page, BOOKINGS_PAGE_SIZE, total)} shown · select a booking to view details and take action
          </span>
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center gap-2">
              {view.page > 1 ? (
                <Link href={bookingsHref(view, { page: view.page - 1, booking: undefined })} className="btn btn-outline btn-sm">
                  Previous
                </Link>
              ) : null}
              <span>
                Page {view.page} of {pages}
              </span>
              {view.page < pages ? (
                <Link href={bookingsHref(view, { page: view.page + 1, booking: undefined })} className="btn btn-outline btn-sm">
                  Next
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>

      <Panel
        open={openId !== null}
        onOpenChange={(open) => {
          if (!open) closeBooking();
        }}
        title={shown ? `Booking ${shown.reference}, ${shown.contact.name}` : openRow ? `Booking ${openRow.reference}, ${openRow.name}` : "Booking"}
        hideHeader
      >
        {shown ? (
          <BookingPanelContent key={shown.id} booking={shown} permissions={permissions} onClose={closeBooking} />
        ) : missing ? (
          <BookingPanelMissing onClose={closeBooking} />
        ) : (
          <BookingPanelSkeleton row={openRow} onClose={closeBooking} />
        )}
      </Panel>
    </>
  );
}
