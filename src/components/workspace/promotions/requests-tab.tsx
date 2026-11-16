"use client";

import { formatGuests, formatRelative, initials } from "@/lib/booking-display";
import { formatMoney } from "@/lib/dates";
import {
  countBy,
  filterByStatus,
  formatDiscountLabel,
  priceAfter,
  REQUEST_FILTERS,
  REQUEST_STATUS_BADGES,
  REQUEST_STATUS_LABELS,
  sortRequests,
  type RequestFilter,
} from "@/lib/promotion-display";
import type { PromotionsContext, RequestItem } from "./promotions-view";
import { RequestPanel } from "./request-panel";
import { FilterChips } from "./shared";

interface RequestsTabProps extends PromotionsContext {
  requests: RequestItem[];
  requestsEnabled: boolean;
  filter: RequestFilter;
  onFilter: (filter: RequestFilter) => void;
  openRequestId: string | null;
  onOpenRequest: (id: string | null) => void;
  onOpenSettings: () => void;
}

export function RequestsTab({ requests, requestsEnabled, filter, onFilter, openRequestId, onOpenRequest, onOpenSettings, ...context }: RequestsTabProps) {
  const { currency, timezone, nowIso } = context;
  const now = new Date(nowIso);
  const counts = countBy(requests, REQUEST_FILTERS);
  const shown = sortRequests(filterByStatus(requests, filter));
  const open = requests.find((request) => request.id === openRequestId) ?? null;

  /** What the customer asked for, and the party's price after it when known. */
  function asked(request: RequestItem) {
    const label = formatDiscountLabel(request.type, request.value, currency);
    if (!request.detail) return { label, after: null };
    return { label, after: formatMoney(priceAfter(request.type, request.value, request.detail.limits.base), currency) };
  }

  return (
    <>
      {!requestsEnabled ? (
        <div className="alert mb-4 flex flex-wrap items-center justify-between gap-3 bg-background">
          <span>
            <strong>Discount requests are turned off.</strong> Customers can’t send new requests; existing ones are still listed.
          </span>
          <button type="button" onClick={onOpenSettings} className="btn btn-outline btn-sm">
            Open settings
          </button>
        </div>
      ) : null}

      <div className="mb-4">
        <FilterChips label="Filter requests" filters={REQUEST_FILTERS} counts={counts} value={filter} onChange={onFilter} />
      </div>

      <div className="card overflow-hidden">
        {shown.length > 0 ? (
          <ul className="divide-y">
            {shown.map((request) => {
              const { label, after } = asked(request);
              return (
                <li key={request.id}>
                  <button
                    type="button"
                    onClick={() => onOpenRequest(request.id)}
                    aria-haspopup="dialog"
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 text-left transition-colors hover:bg-muted/50 active:bg-muted sm:px-6"
                  >
                    <span className="avatar" aria-hidden="true">
                      {initials(request.name)}
                    </span>
                    <span className="min-w-[180px] flex-1">
                      <span className="block font-bold">
                        {request.name} <span className="font-normal text-muted-foreground">· {request.reference}</span>
                      </span>
                      <span className="text-[13px] text-muted-foreground">
                        {request.tourTitle} · {formatGuests(request.adults, request.children)}
                      </span>
                      {request.reason ? (
                        <span className="mt-0.5 line-clamp-1 text-[13px] italic text-muted-foreground">“{request.reason}”</span>
                      ) : null}
                    </span>
                    <span className="text-sm">
                      <span className="block text-xs text-muted-foreground">Requested</span>
                      <span className="font-semibold">{label}</span>
                    </span>
                    {after ? (
                      <span className="text-sm">
                        <span className="block text-xs text-muted-foreground">Price after</span>
                        <span className="font-semibold">{after}</span>
                      </span>
                    ) : request.status === "approved" && request.decidedType && request.decidedValue ? (
                      <span className="text-sm">
                        <span className="block text-xs text-muted-foreground">Approved</span>
                        <span className="font-semibold">{formatDiscountLabel(request.decidedType, request.decidedValue, currency)}</span>
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">{formatRelative(request.createdAt, now, timezone)}</span>
                    <span className={REQUEST_STATUS_BADGES[request.status]}>{REQUEST_STATUS_LABELS[request.status]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : requests.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-semibold">No discount requests yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {requestsEnabled
                ? "When a customer asks for a discount on your website, the request arrives here for you to approve or reject."
                : "Turn on discount requests in Settings to let customers ask for a discount from your website."}
            </p>
          </div>
        ) : (
          <p className="p-10 text-center text-muted-foreground">No requests in this view.</p>
        )}
      </div>

      <RequestPanel request={open} onClose={() => onOpenRequest(null)} {...context} />
    </>
  );
}
