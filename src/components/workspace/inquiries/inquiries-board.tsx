"use client";

import { Archive, ChevronLeft, ChevronRight, Inbox, Mail, MailOpen, MessageCircle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { deleteInquiryAction, markInquiryReadAction, setInquiryStatusAction } from "@/app/workspace/inquiries/actions";
import { ConfirmDialog, Panel, Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { formatDate, formatDateTime, formatRelative, hrefWith, mailtoLink, pageCount, pageSummary } from "@/lib/booking-display";
import { cn } from "@/lib/utils";
import type { InquiryView } from "@/server/content/inquiries";
import { effectiveStatus, emptyTabMessage, INQUIRY_TABS, inquiryActions, nextTabIndex, statusToast, type InquiryStatus } from "./status";

export type InquiryItem = InquiryView & {
  /** Click-to-chat link, built on the server; null when messaging is not connected or there is no phone. */
  whatsappHref: string | null;
};

interface InquiriesBoardProps {
  items: InquiryItem[];
  /** Enquiries matching the current tab, before paging. */
  total: number;
  page: number;
  pageSize: number;
  /** null = the "All" tab. */
  status: InquiryStatus | null;
  /** Enquiries per status, for the tab counts. */
  counts: Record<InquiryStatus, number>;
  /** The server's clock when the list was rendered, so relative times match on both sides. */
  nowIso: string;
  timezone: string;
  workspaceName: string;
}

const PATH = "/workspace/inquiries";
const tabId = (status: InquiryStatus | null) => `inquiries-tab-${status ?? "all"}`;

export function InquiriesBoard({ items, total, page, pageSize, status, counts, nowIso, timezone, workspaceName }: InquiriesBoardProps) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [selected, setSelected] = useState<InquiryItem | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Status changes made here show at once; the refreshed list then agrees with them.
  const [overrides, setOverrides] = useState<Record<string, InquiryStatus>>({});
  const markedRead = useRef(new Set<string>());
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const now = new Date(nowIso);
  const pages = pageCount(total, pageSize);
  const statusOf = (item: InquiryItem) => effectiveStatus(item.id, item.status, overrides);

  const markRead = useAction(markInquiryReadAction);
  const changeStatus = useAction(setInquiryStatusAction, {
    success: (data) => statusToast(data.status),
    onSuccess: (data) => {
      setOverrides((current) => ({ ...current, [data.id]: data.status }));
      if (data.status === "new") markedRead.current.delete(data.id);
      // Moving back to the inbox keeps the message open; filing it away closes it.
      if (data.status !== "read") setOpen(false);
    },
  });
  const remove = useAction(deleteInquiryAction, {
    success: "Enquiry deleted",
    onSuccess: () => {
      setConfirmingDelete(false);
      setOpen(false);
    },
  });
  const busy = changeStatus.pending || remove.pending;
  // Which change is in flight, so only the button that was pressed shows the spinner.
  const [target, setTarget] = useState<InquiryStatus | null>(null);
  const changing = (next: InquiryStatus) => changeStatus.pending && target === next;

  function setStatus(id: string, next: InquiryStatus) {
    setTarget(next);
    void changeStatus.run({ id, status: next });
  }

  function selectTab(next: InquiryStatus | null) {
    if (next === status) return;
    startNavigation(() => router.push(hrefWith(PATH, { status: next })));
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabRefs.current.findIndex((tab) => tab === document.activeElement);
    const next = nextTabIndex(event.key, current < 0 ? 0 : current, INQUIRY_TABS.length);
    if (next === null) return;
    event.preventDefault();
    tabRefs.current[next]?.focus();
  }

  function openInquiry(item: InquiryItem) {
    setSelected(item);
    setOpen(true);
    if (statusOf(item) !== "new" || markedRead.current.has(item.id)) return;
    markedRead.current.add(item.id);
    setOverrides((current) => ({ ...current, [item.id]: "read" }));
    void markRead.run({ id: item.id }).then((result) => {
      if (result.ok) return;
      // It is still unread on the server: show it that way again.
      markedRead.current.delete(item.id);
      setOverrides((current) => {
        const rest = { ...current };
        delete rest[item.id];
        return rest;
      });
    });
  }

  // The freshest copy of the open enquiry; the stored one keeps the panel
  // filled while it slides away or after the row has left the current tab.
  const shown = selected ? (items.find((item) => item.id === selected.id) ?? selected) : null;
  const shownStatus = shown ? statusOf(shown) : "read";
  const actions = inquiryActions(shownStatus);

  return (
    <>
      <div
        role="tablist"
        aria-label="Status"
        className="tabs-list no-scrollbar mb-4 max-w-full justify-start overflow-x-auto"
        onKeyDown={onTabKeyDown}
      >
        {INQUIRY_TABS.map((tab, index) => {
          const active = tab.status === status;
          return (
            <button
              key={tab.label}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={tabId(tab.status)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="inquiries-list"
              tabIndex={active ? 0 : -1}
              className="tabs-trigger"
              onClick={() => selectTab(tab.status)}
            >
              {tab.label}
              <span className="rounded-full bg-muted-foreground/15 px-1.5 text-xs">
                {tab.status ? counts[tab.status] : counts.new + counts.read + counts.archived}
                {tab.status === "new" ? <span className="sr-only"> unread</span> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div
        id="inquiries-list"
        role="tabpanel"
        aria-labelledby={tabId(status)}
        aria-busy={navigating || undefined}
        className={cn("card overflow-hidden transition-opacity duration-150", navigating && "opacity-60")}
      >
        {items.length > 0 ? (
          <ul className="divide-y">
            {items.map((item) => {
              const itemStatus = statusOf(item);
              const received = new Date(item.createdAt);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 px-5 py-3.5 text-left hover:bg-muted/50 active:bg-muted"
                    aria-haspopup="dialog"
                    onClick={() => openInquiry(item)}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn("truncate", itemStatus === "new" ? "font-bold" : "font-medium")}>{item.name}</span>
                        {itemStatus === "new" ? <span className="badge badge-pending">New</span> : null}
                        {itemStatus === "archived" ? <span className="badge badge-outline">Archived</span> : null}
                      </span>
                      <time dateTime={received.toISOString()} className="shrink-0 text-xs text-muted-foreground">
                        {formatRelative(received, now, timezone)}
                      </time>
                    </span>
                    {item.tour ? <span className="truncate text-[13px] text-muted-foreground">{item.tour.title}</span> : null}
                    <span className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{item.message}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-14 text-center">
            <p className="font-bold">Nothing here</p>
            <p className="text-sm text-muted-foreground">{emptyTabMessage(status)}</p>
            {status ? (
              <button type="button" className="btn btn-outline btn-sm mt-4" onClick={() => selectTab(null)}>
                Show all enquiries
              </button>
            ) : null}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-[13px] text-muted-foreground">
          <span>{pageSummary(page, pageSize, total)} · select an enquiry to read and reply</span>
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center gap-2">
              <PageLink href={page > 1 ? hrefWith(PATH, { status, page: page > 2 ? page - 1 : undefined }) : null}>
                <ChevronLeft aria-hidden="true" />
                Previous
              </PageLink>
              <span aria-current="page">
                Page {page} of {pages}
              </span>
              <PageLink href={page < pages ? hrefWith(PATH, { status, page: page + 1 }) : null}>
                Next
                <ChevronRight aria-hidden="true" />
              </PageLink>
            </nav>
          ) : null}
        </div>
      </div>

      <Panel
        open={open}
        onOpenChange={setOpen}
        title={shown?.name ?? "Enquiry"}
        description={shown ? `Received ${formatDateTime(shown.createdAt, timezone)}` : undefined}
      >
        {shown ? (
          <div className="flex flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-6 p-5 sm:p-6">
              <section aria-label="Contact" className="flex flex-col gap-2 rounded-lg bg-muted/60 p-4 text-sm">
                <DetailRow label="Status">
                  <span
                    className={cn(
                      "badge",
                      shownStatus === "new" ? "badge-pending" : shownStatus === "archived" ? "badge-outline" : "badge-secondary",
                    )}
                  >
                    {shownStatus === "new" ? "New" : shownStatus === "archived" ? "Archived" : "Read"}
                  </span>
                </DetailRow>
                <DetailRow label="E-mail">
                  <span className="break-all">{shown.email}</span>
                </DetailRow>
                {shown.phone ? <DetailRow label="Phone">{shown.phone}</DetailRow> : null}
                {shown.tour ? <DetailRow label="Tour">{shown.tour.title}</DetailRow> : null}
                {shown.preferredDate ? <DetailRow label="Preferred date">{formatDate(shown.preferredDate, "long")}</DetailRow> : null}
              </section>

              <section aria-labelledby="inquiry-message-heading">
                <h3 id="inquiry-message-heading" className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Message
                </h3>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{shown.message}</p>
              </section>
            </div>

            {/* Thumb-reach bar on phones; the first row of the panel from sm up, as in the booking panel. */}
            <div className="safe-b sticky bottom-0 flex flex-wrap gap-2 border-t bg-background px-5 pt-3 sm:static sm:order-first sm:border-t-0 sm:px-6 sm:pb-0 sm:pt-6">
              <a className="btn btn-default" href={mailtoLink(shown.email, `Re: your enquiry to ${workspaceName}`)}>
                <Mail aria-hidden="true" />
                Reply by e-mail
              </a>
              {shown.whatsappHref ? (
                <a className="btn btn-outline" href={shown.whatsappHref} target="_blank" rel="noreferrer">
                  <MessageCircle aria-hidden="true" />
                  WhatsApp
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
              {actions.archive ? (
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={busy}
                  aria-busy={changing("archived") || undefined}
                  onClick={() => setStatus(shown.id, "archived")}
                >
                  {changing("archived") ? <Spinner /> : <Archive aria-hidden="true" />}
                  Archive
                </button>
              ) : null}
              {actions.restore ? (
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={busy}
                  aria-busy={changing("read") || undefined}
                  onClick={() => setStatus(shown.id, "read")}
                >
                  {changing("read") ? <Spinner /> : <Inbox aria-hidden="true" />}
                  Move to inbox
                </button>
              ) : null}
              {actions.markUnread ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  aria-busy={changing("new") || undefined}
                  onClick={() => setStatus(shown.id, "new")}
                >
                  {changing("new") ? <Spinner /> : <MailOpen aria-hidden="true" />}
                  Mark as unread
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-outline text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </button>
            </div>
          </div>
        ) : null}
      </Panel>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={shown ? `Delete the enquiry from ${shown.name}?` : "Delete this enquiry?"}
        description="The message is removed for everyone in this workspace. This cannot be undone; archive it instead if you may need it later."
        confirmLabel="Delete enquiry"
        cancelLabel="Keep enquiry"
        destructive
        pending={remove.pending}
        onConfirm={() => {
          if (shown) void remove.run({ id: shown.id });
        }}
      />
    </>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-semibold">{children}</span>
    </div>
  );
}

/** A pager link, or the same shape disabled when there is nowhere to go. */
function PageLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) {
    return (
      <span className="btn btn-outline btn-sm" aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className="btn btn-outline btn-sm">
      {children}
    </Link>
  );
}
