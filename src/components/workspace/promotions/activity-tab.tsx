"use client";

import { useMemo, useState } from "react";
import { loadPromotionActivityAction } from "@/app/workspace/promotions/actions";
import { FormError } from "@/components/form";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { formatDateTime } from "@/lib/booking-display";
import {
  ACTIVITY_AREA_LABELS,
  ACTIVITY_AREAS,
  activityActor,
  activityKind,
  describeActivity,
  type ActivityArea,
  type ActivityLookups,
} from "@/lib/promotion-display";
import type { AuditPage } from "@/server/audit/read";
import type { PersonalDiscountView } from "@/server/promotions/personal-discounts";
import type { PromotionsContext, RequestItem } from "./promotions-view";

interface ActivityTabProps extends PromotionsContext {
  /** Newest entries of every kind, read with the page. */
  initial: AuditPage;
  personal: PersonalDiscountView[];
  requests: RequestItem[];
}

export function ActivityTab({ initial, personal, requests, currency, timezone }: ActivityTabProps) {
  const [area, setArea] = useState<ActivityArea>("all");
  const [page, setPage] = useState<AuditPage>(initial);
  // Which request is in flight: a new filter replaces the list, "older" extends it.
  const [loading, setLoading] = useState<"filter" | "older" | null>(null);
  const load = useAction(loadPromotionActivityAction, { toastError: false });

  const lookups: ActivityLookups = useMemo(
    () => ({
      currency,
      personalNames: Object.fromEntries(personal.map((discount) => [discount.id, discount.customerName])),
      requests: Object.fromEntries(requests.map((request) => [request.id, { name: request.name, reference: request.reference }])),
    }),
    [currency, personal, requests],
  );

  async function pickArea(next: ActivityArea) {
    if (next === area || loading) return;
    setArea(next);
    setLoading("filter");
    const result = await load.run({ area: next });
    setLoading(null);
    if (result.ok) setPage(result.data);
  }

  async function loadOlder() {
    if (!page.nextCursor || loading) return;
    setLoading("older");
    const result = await load.run({ area, cursor: page.nextCursor });
    setLoading(null);
    if (result.ok) setPage({ items: [...page.items, ...result.data.items], nextCursor: result.data.nextCursor });
  }

  const rows = page.items.map((entry) => ({
    id: entry.id,
    at: formatDateTime(entry.createdAt, timezone),
    who: activityActor(entry, lookups),
    what: describeActivity(entry, lookups),
    kind: activityKind(entry.action),
  }));

  return (
    <>
      <div role="group" aria-label="Filter activity" className="mb-4 flex flex-wrap gap-2">
        {ACTIVITY_AREAS.map((key) => (
          <button key={key} type="button" className="chip h-9 px-3.5 text-[13px]" aria-pressed={key === area} onClick={() => void pickArea(key)}>
            {ACTIVITY_AREA_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden" aria-busy={loading === "filter" || undefined}>
        {loading === "filter" ? (
          <div className="flex flex-col gap-3 p-5" aria-label="Loading activity">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="skeleton h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">
            {area === "all" ? "Nothing has happened here yet. Changes to campaigns, discounts, requests and settings will be listed here." : "No activity of this kind yet."}
          </p>
        ) : (
          <>
            <ul className="divide-y md:hidden">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-col gap-1 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{row.at}</span>
                    <span className={row.kind.badge}>{row.kind.label}</span>
                  </div>
                  <p className="text-sm">{row.what}</p>
                  <p className="text-xs font-semibold text-muted-foreground">{row.who}</p>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="table min-w-[720px]">
                <thead>
                  <tr>
                    <th className="pl-6">When</th>
                    <th>Who</th>
                    <th>What happened</th>
                    <th className="pr-6">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap pl-6 text-[13px] text-muted-foreground">{row.at}</td>
                      <td className="text-sm font-semibold">{row.who}</td>
                      <td className="text-sm">{row.what}</td>
                      <td className="pr-6">
                        <span className={row.kind.badge}>{row.kind.label}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <FormError message={load.error} className="mt-4" />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          History can’t be edited or deleted. Every campaign change, assignment, decision and redemption is recorded.
        </p>
        {page.nextCursor && loading !== "filter" ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void loadOlder()} disabled={loading !== null} aria-busy={loading === "older" || undefined}>
            {loading === "older" ? <Spinner /> : null}
            Show older
          </button>
        ) : null}
      </div>
    </>
  );
}
