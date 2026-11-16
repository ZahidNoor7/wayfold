"use client";

import { Archive, ArchiveRestore, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  archiveTourAction,
  deleteTourAction,
  duplicateTourAction,
  publishTourAction,
  restoreTourAction,
  setTourFeaturedAction,
  unpublishTourAction,
} from "@/app/workspace/tours/actions";
import { ConfirmDialog } from "@/components/overlays";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MediaThumb } from "@/components/workspace/media/media-thumb";
import { useAction } from "@/hooks/use-action";
import { formatMoney } from "@/lib/dates";
import { locateErrors, SECTION_LABELS, type LocatedError } from "./tour-form-model";
import { durationText } from "./tour-list-params";

export interface TourRowItem {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  place: string;
  categoryName: string | null;
  destinationName: string | null;
  durationDays: number;
  durationLabel: string;
  priceAdult: number;
  isFeatured: boolean;
  coverUrl: string | null;
  mediaCount: number;
}

interface ToursListProps {
  items: TourRowItem[];
  currency: string;
  canManage: boolean;
  canPublish: boolean;
}

type PublishProblem =
  | { kind: "limit"; tour: TourRowItem; message: string }
  | { kind: "incomplete"; tour: TourRowItem; message: string; errors: LocatedError[] }
  | { kind: "other"; tour: TourRowItem; message: string };

const editHref = (id: string) => `/workspace/tours/${id}`;

export function ToursList({ items, currency, canManage, canPublish }: ToursListProps) {
  const router = useRouter();
  const [problem, setProblem] = useState<PublishProblem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<{ tour: TourRowItem; refusal: string | null } | null>(null);
  const [toArchive, setToArchive] = useState<TourRowItem | null>(null);

  const publish = useAction(publishTourAction, { toastError: false });
  const unpublish = useAction(unpublishTourAction);
  const feature = useAction(setTourFeaturedAction);
  const duplicate = useAction(duplicateTourAction);
  const archive = useAction(archiveTourAction);
  const restore = useAction(restoreTourAction);
  const remove = useAction(deleteTourAction, { toastError: false });

  async function withBusy<T>(id: string, work: () => Promise<T>): Promise<T> {
    setBusy(id);
    try {
      return await work();
    } finally {
      setBusy(null);
    }
  }

  async function togglePublished(tour: TourRowItem) {
    setProblem(null);
    if (tour.status === "published") {
      const result = await withBusy(tour.id, () => unpublish.run({ id: tour.id }));
      if (result.ok) toast.success(`“${tour.title}” unpublished`);
      return;
    }
    const result = await withBusy(tour.id, () => publish.run({ id: tour.id }));
    if (result.ok) {
      toast.success(`“${tour.title}” is live`);
    } else if (result.code === "plan_limit") {
      setProblem({ kind: "limit", tour, message: result.error });
    } else if (result.fieldErrors) {
      setProblem({ kind: "incomplete", tour, message: result.error, errors: locateErrors(result.fieldErrors) });
    } else {
      setProblem({ kind: "other", tour, message: result.error });
    }
  }

  async function toggleFeatured(tour: TourRowItem) {
    const result = await withBusy(tour.id, () => feature.run({ id: tour.id, featured: !tour.isFeatured }));
    if (result.ok) toast.success(result.data.isFeatured ? "Featured on homepage" : "Removed from homepage");
  }

  async function makeCopy(tour: TourRowItem) {
    const result = await withBusy(tour.id, () => duplicate.run({ id: tour.id }));
    if (result.ok) {
      toast.success("Tour duplicated as a draft");
      router.push(editHref(result.data.id));
    }
  }

  async function bringBack(tour: TourRowItem) {
    const result = await withBusy(tour.id, () => restore.run({ id: tour.id }));
    if (result.ok) toast.success(`“${tour.title}” restored as a draft`);
  }

  async function confirmArchive(tour: TourRowItem) {
    const result = await archive.run({ id: tour.id });
    if (result.ok) {
      toast.success(`“${tour.title}” archived`);
      setToArchive(null);
      setToDelete(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const result = await remove.run({ id: toDelete.tour.id });
    if (result.ok) {
      toast.success(`Deleted ${toDelete.tour.title}`);
      setToDelete(null);
    } else {
      // Tours with bookings or reviews cannot be deleted; offer what can be done.
      setToDelete({ tour: toDelete.tour, refusal: result.error });
    }
  }

  const switchesFor = (tour: TourRowItem) => ({
    featured: (
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={tour.isFeatured}
        aria-label={`Featured: ${tour.title}`}
        disabled={!canManage || tour.status === "archived" || busy === tour.id}
        onClick={() => void toggleFeatured(tour)}
      >
        <span className="switch-thumb" />
      </button>
    ),
    published: (
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={tour.status === "published"}
        aria-label={`Published: ${tour.title}`}
        disabled={!canPublish || tour.status === "archived" || busy === tour.id}
        onClick={() => void togglePublished(tour)}
      >
        <span className="switch-thumb" />
      </button>
    ),
  });

  const menuFor = (tour: TourRowItem) =>
    canManage ? (
      <DropdownMenu>
        <DropdownMenuTrigger className="btn btn-ghost btn-icon btn-sm" aria-label={`More actions for ${tour.title}`} disabled={busy === tour.id}>
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => void makeCopy(tour)}>
            <Copy aria-hidden="true" />
            Duplicate
          </DropdownMenuItem>
          {tour.status === "archived" ? (
            <DropdownMenuItem onSelect={() => void bringBack(tour)}>
              <ArchiveRestore aria-hidden="true" />
              Restore as draft
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setToArchive(tour)}>
              <Archive aria-hidden="true" />
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              remove.reset();
              setToDelete({ tour, refusal: null });
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const refusal = toDelete?.refusal ?? null;
  const alreadyArchived = toDelete?.tour.status === "archived";

  const statusBadge = (tour: TourRowItem) =>
    tour.status === "draft" ? (
      <span className="badge badge-outline text-muted-foreground">Draft</span>
    ) : tour.status === "archived" ? (
      <span className="badge badge-secondary">Archived</span>
    ) : null;

  return (
    <>
      {problem ? (
        <div role="alert" className="alert alert-warning mb-4 flex flex-col gap-3">
          <div>
            <p className="font-semibold">“{problem.tour.title}” was not published</p>
            <p className="mt-1">{problem.message}</p>
            {problem.kind === "incomplete" ? (
              <ul className="mt-2 list-disc pl-5">
                {problem.errors.map((error, index) => (
                  <li key={`${error.field}-${index}`}>
                    {SECTION_LABELS[error.section]}: {error.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {problem.kind === "limit" ? (
              <Link href="/workspace/billing" className="btn btn-default btn-sm">
                See plans
              </Link>
            ) : null}
            {problem.kind === "incomplete" && canManage ? (
              <Link href={editHref(problem.tour.id)} className="btn btn-default btn-sm">
                Finish this tour
              </Link>
            ) : null}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setProblem(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="hidden overflow-x-auto md:block">
          <table className="table min-w-[880px]">
            <thead>
              <tr>
                <th className="pl-6">Tour</th>
                <th>Category</th>
                <th>Duration</th>
                <th>From</th>
                <th>Featured</th>
                <th>Published</th>
                <th className="pr-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((tour) => {
                const switches = switchesFor(tour);
                return (
                  <tr key={tour.id}>
                    <td className="pl-6">
                      <span className="flex items-center gap-3">
                        <MediaThumb media={tour.coverUrl ? { url: tour.coverUrl } : null} alt="" className="h-11 w-16" sizes="64px" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            {canManage ? (
                              <Link href={editHref(tour.id)} className="font-bold underline-offset-4 hover:underline">
                                {tour.title}
                              </Link>
                            ) : (
                              <span className="font-bold">{tour.title}</span>
                            )}
                            {statusBadge(tour)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {tour.place || tour.destinationName || "No place set"} · {tour.mediaCount} {tour.mediaCount === 1 ? "photo" : "photos"}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>{tour.categoryName ?? <span className="text-muted-foreground">None</span>}</td>
                    <td>{durationText(tour)}</td>
                    <td className="font-semibold">{tour.priceAdult > 0 ? formatMoney(tour.priceAdult, currency) : <span className="font-normal text-muted-foreground">Not set</span>}</td>
                    <td>{switches.featured}</td>
                    <td>{switches.published}</td>
                    <td className="whitespace-nowrap pr-6 text-right">
                      <span className="inline-flex items-center gap-1">
                        {canManage ? (
                          <Link href={editHref(tour.id)} className="btn btn-outline btn-sm">
                            Edit
                          </Link>
                        ) : null}
                        {menuFor(tour)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <ul className="divide-y md:hidden">
          {items.map((tour) => {
            const switches = switchesFor(tour);
            return (
              <li key={tour.id} className="flex gap-3 p-4">
                <MediaThumb media={tour.coverUrl ? { url: tour.coverUrl } : null} alt="" className="h-16 w-20" sizes="80px" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="truncate font-bold">{tour.title}</span>
                    {statusBadge(tour)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[tour.categoryName, durationText(tour), tour.priceAdult > 0 ? formatMoney(tour.priceAdult, currency) : null].filter(Boolean).join(" · ")}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold">
                    <span className="flex items-center gap-2">{switches.published}Live</span>
                    <span className="flex items-center gap-2">{switches.featured}Featured</span>
                    <span className="ml-auto flex items-center gap-1">
                      {canManage ? (
                        <Link href={editHref(tour.id)} className="btn btn-outline btn-sm">
                          <Pencil aria-hidden="true" />
                          Edit
                        </Link>
                      ) : null}
                      {menuFor(tour)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => (open ? undefined : setToArchive(null))}
        title={`Archive “${toArchive?.title ?? ""}”?`}
        description="It comes off your website and out of the active list. Its bookings and history are kept, and you can restore it as a draft at any time."
        confirmLabel="Archive tour"
        pending={archive.pending}
        onConfirm={() => (toArchive ? void confirmArchive(toArchive) : undefined)}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => (open ? undefined : setToDelete(null))}
        title={refusal ? "This tour can’t be deleted" : `Delete “${toDelete?.tour.title ?? ""}”?`}
        description={
          refusal ? (
            // Tours with bookings or reviews stay on record; archiving is what takes them off the website.
            <p role="alert">
              {refusal}
              {alreadyArchived ? " It is already archived, so it is off your website." : ""}
            </p>
          ) : (
            "This removes it from your website immediately, with its itinerary, dates and gallery. This can’t be undone."
          )
        }
        confirmLabel={refusal ? (alreadyArchived ? "Close" : "Archive instead") : "Delete"}
        cancelLabel={refusal ? "Cancel" : "Keep it"}
        destructive={!refusal}
        pending={refusal ? archive.pending : remove.pending}
        onConfirm={() => {
          if (!toDelete) return;
          if (!refusal) void confirmDelete();
          else if (alreadyArchived) setToDelete(null);
          else void confirmArchive(toDelete.tour);
        }}
      />
    </>
  );
}
