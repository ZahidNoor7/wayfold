import { barHeight, chartMax, chartSummary, type ChartPoint } from "@/lib/booking-display";

/**
 * The design's grouped bar chart: two bars per month, drawn with flex and
 * percentages. The picture is one image to assistive technology, named by a
 * sentence; the figures themselves follow in a table only screen readers see.
 */
export function BookingsChart({ points }: { points: ChartPoint[] }) {
  const max = chartMax(points);
  const first = points[0];
  const last = points.at(-1);

  return (
    <section aria-labelledby="overview-chart" className="card">
      <div className="card-header flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <h2 id="overview-chart" className="card-title">
            Booking requests
          </h2>
          <p className="card-description mt-1.5">Last {points.length} months, by the month the request arrived</p>
        </div>
        <span className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-primary" />
            Confirmed
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-highlight" />
            Requests
          </span>
        </span>
      </div>
      <div className="card-content">
        <div role="img" aria-label={chartSummary(points)} className="relative flex h-56 items-end gap-3 border-b pb-7 sm:gap-5">
          {max === 0 ? (
            <p className="absolute inset-x-0 top-1/3 text-center text-sm text-muted-foreground">
              No bookings for tours in these months yet.
            </p>
          ) : null}
          {points.map((point, index) => (
            <div key={point.label} className="relative flex h-full flex-1 items-end justify-center gap-1">
              <div
                className="w-1/3 max-w-6 origin-bottom animate-grow rounded-t-md bg-highlight"
                style={{ height: `${barHeight(point.requests, max)}%`, animationDelay: `${index * 0.06}s` }}
                title={`${point.requests} ${point.requests === 1 ? "request" : "requests"}`}
              />
              <div
                className="w-1/3 max-w-6 origin-bottom animate-grow rounded-t-md bg-primary"
                style={{ height: `${barHeight(point.confirmed, max)}%`, animationDelay: `${index * 0.06}s` }}
                title={`${point.confirmed} confirmed`}
              />
              <span className="absolute -bottom-6 text-xs text-muted-foreground">{point.label}</span>
            </div>
          ))}
        </div>
        <table className="sr-only">
          <caption>
            Booking requests and confirmed bookings by month of request{first && last ? `, ${first.longLabel} to ${last.longLabel}` : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Requests</th>
              <th scope="col">Confirmed</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.longLabel}</th>
                <td>{point.requests}</td>
                <td>{point.confirmed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
