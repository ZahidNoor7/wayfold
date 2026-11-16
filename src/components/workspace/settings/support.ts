import type { SupportGrantView } from "@/server/support";

/** Display helpers for the Support access page. */

export const ACCESS_DURATIONS: readonly { hours: number; label: string }[] = [
  { hours: 1, label: "1 hour" },
  { hours: 4, label: "4 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
];

export const DEFAULT_ACCESS_HOURS = 4;

export const GRANT_STATUS_META: Record<SupportGrantView["status"], { label: string; badge: string }> = {
  requested: { label: "Waiting for you", badge: "badge-pending" },
  approved: { label: "Access open", badge: "badge-confirmed" },
  denied: { label: "Denied", badge: "badge-cancelled" },
  revoked: { label: "Revoked", badge: "badge-cancelled" },
  expired: { label: "Expired", badge: "badge-completed" },
};

type GrantLike = Pick<SupportGrantView, "status" | "expiresAt">;

/** Splits requests into those waiting for a decision, open windows, and everything past. */
export function groupGrants<T extends GrantLike>(grants: readonly T[], now: Date = new Date()): { pending: T[]; active: T[]; history: T[] } {
  const pending: T[] = [];
  const active: T[] = [];
  const history: T[] = [];
  for (const grant of grants) {
    if (grant.status === "requested") pending.push(grant);
    else if (grant.status === "approved" && grant.expiresAt && new Date(grant.expiresAt).getTime() > now.getTime()) active.push(grant);
    else history.push(grant);
  }
  return { pending, active, history };
}

/** "2 h 15 min left", "45 min left", "Less than a minute left", or "Ended". */
export function timeLeft(expiresAt: Date | string | null, now: Date = new Date()): string {
  if (!expiresAt) return "Ended";
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "Ended";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Less than a minute left";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min left`;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const extra = hours % 24;
    return extra ? `${days} d ${extra} h left` : `${days} d left`;
  }
  return rest ? `${hours} h ${rest} min left` : `${hours} h left`;
}
