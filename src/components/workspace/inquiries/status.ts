/**
 * Pure rules for the enquiries inbox: which tabs exist, what a status change
 * is called, and which actions an enquiry offers in each status.
 */
export type InquiryStatus = "new" | "read" | "archived";

export interface InquiryTab {
  /** null = every status. */
  status: InquiryStatus | null;
  label: string;
}

export const INQUIRY_TABS: readonly InquiryTab[] = [
  { status: null, label: "All" },
  { status: "new", label: "New" },
  { status: "read", label: "Read" },
  { status: "archived", label: "Archived" },
];

/** The status to show: a change made in this session wins until the list catches up. */
export function effectiveStatus(id: string, stored: InquiryStatus, overrides: Readonly<Record<string, InquiryStatus>>): InquiryStatus {
  return overrides[id] ?? stored;
}

export interface InquiryActions {
  /** Move out of the inbox. */
  archive: boolean;
  /** Bring an archived message back as read. */
  restore: boolean;
  markUnread: boolean;
}

export function inquiryActions(status: InquiryStatus): InquiryActions {
  return {
    archive: status !== "archived",
    restore: status === "archived",
    markUnread: status === "read",
  };
}

/** Names what a status change did, in the same words as the button that caused it. */
export function statusToast(status: InquiryStatus): string {
  if (status === "archived") return "Enquiry archived";
  if (status === "new") return "Enquiry marked as unread";
  return "Enquiry moved to inbox";
}

/** Copy for a tab that has nothing in it. */
export function emptyTabMessage(status: InquiryStatus | null): string {
  if (status === "new") return "You have read every enquiry.";
  if (status === "read") return "No read enquiries are waiting in the inbox.";
  if (status === "archived") return "Enquiries you archive are kept here.";
  return "There are no enquiries on this page.";
}

/** Index of the tab to focus after an arrow, Home or End key; null for any other key. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
