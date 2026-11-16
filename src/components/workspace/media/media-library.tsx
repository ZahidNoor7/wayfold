"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FolderPlus, Pencil, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Field, firstError, SubmitButton } from "@/components/form";
import { ConfirmDialog, Modal, Spinner } from "@/components/overlays";
import { EmptyState, PageHeader } from "@/components/workspace/page-header";
import { useAction } from "@/hooks/use-action";
import { formatBytes, formatDuration, storagePercent, type MediaKind } from "@/lib/media-upload";
import { cn } from "@/lib/utils";
import { createFolderAction, deleteFolderAction, listMediaAction, renameFolderAction } from "./actions";
import { AssetPanel } from "./asset-panel";
import { MediaThumb } from "./media-thumb";
import { mediaLabel, type MediaFolderItem, type MediaItem, type MediaPageResult, type StorageUsageView } from "./types";
import { Dropzone, UploadList } from "./upload-ui";
import { useMediaUploads } from "./use-media-uploads";

const PAGE_SIZE = 40;
type KindFilter = "all" | MediaKind;

interface Filters {
  search: string;
  kind: KindFilter;
  /** "all" = every file, "none" = files in no folder, otherwise a folder id. */
  folder: string;
}

const NO_FILTERS: Filters = { search: "", kind: "all", folder: "all" };

function toQuery(filters: Filters, cursor?: string) {
  return {
    limit: PAGE_SIZE,
    ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
    ...(filters.kind !== "all" ? { resourceType: filters.kind } : {}),
    ...(filters.folder === "none" ? { folderId: null } : filters.folder !== "all" ? { folderId: filters.folder } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/** Whether a file belongs in the list the filters currently describe. */
function matches(item: MediaItem, filters: Filters): boolean {
  if (filters.kind !== "all" && item.resourceType !== filters.kind) return false;
  if (filters.folder === "none" && item.folderId !== null) return false;
  if (filters.folder !== "all" && filters.folder !== "none" && item.folderId !== filters.folder) return false;
  const search = filters.search.trim().toLowerCase();
  return !search || item.originalFilename.toLowerCase().includes(search) || item.alt.toLowerCase().includes(search);
}

interface MediaLibraryProps {
  /** First page of the unfiltered library, rendered on the server. */
  initial: MediaPageResult;
  folders: MediaFolderItem[];
  usage: StorageUsageView;
  canManage: boolean;
  /** Whether new files have somewhere to go. */
  storage: "ready" | "missing" | "error";
  storageMessage: string | null;
  /** The member may open the integrations settings. */
  canConnect: boolean;
  timezone: string;
}

export function MediaLibrary({ initial, folders, usage, canManage, storage, storageMessage, canConnect, timezone }: MediaLibraryProps) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [items, setItems] = useState<MediaItem[]>(initial.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ mode: "create" } | { mode: "rename"; folder: MediaFolderItem } | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<MediaFolderItem | null>(null);

  const request = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const canUpload = canManage && storage === "ready";
  const currentFolder = folders.find((folder) => folder.id === filters.folder) ?? null;
  const filtered = filters.search.trim() !== "" || filters.kind !== "all" || filters.folder !== "all";
  const openItem = items.find((item) => item.id === openId) ?? null;

  async function load(next: Filters) {
    const ticket = ++request.current;
    setLoading(true);
    setError(null);
    const result = await listMediaAction(toQuery(next)).catch(() => null);
    if (ticket !== request.current) return;
    setLoading(false);
    if (!result || !result.ok) {
      setError(result?.error ?? "We could not reach the server. Check your connection and try again.");
      return;
    }
    setItems(result.data.items);
    setNextCursor(result.data.nextCursor);
  }

  function change(patch: Partial<Filters>, debounce = false) {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (debounce) searchTimer.current = setTimeout(() => void load(next), 300);
    else void load(next);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const ticket = request.current;
    setLoadingMore(true);
    const result = await listMediaAction(toQuery(filters, nextCursor)).catch(() => null);
    setLoadingMore(false);
    if (ticket !== request.current) return;
    if (!result || !result.ok) {
      setError(result?.error ?? "We could not load more files. Try again.");
      return;
    }
    setError(null);
    setItems((current) => [...current, ...result.data.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
    setNextCursor(result.data.nextCursor);
  }

  const uploads = useMediaUploads({
    folderId: currentFolder?.id ?? null,
    onUploaded: (item) => {
      if (matches(item, filters)) setItems((current) => (current.some((existing) => existing.id === item.id) ? current : [item, ...current]));
    },
  });

  const removeFolder = useAction(deleteFolderAction, {
    success: "Folder deleted",
    onSuccess: ({ id }) => {
      setFolderToDelete(null);
      // Its files are now in no folder; show the whole library again.
      if (filters.folder === id) change({ folder: "all" });
      else setItems((current) => current.map((item) => (item.folderId === id ? { ...item, folderId: null } : item)));
    },
  });

  const percent = storagePercent(usage.usedBytes, usage.limitMb);
  const kinds: { value: KindFilter; label: string }[] = [
    { value: "all", label: "All types" },
    { value: "image", label: "Images" },
    { value: "video", label: "Videos" },
  ];

  return (
    <>
      <PageHeader
        title="Media library"
        description="Photos and videos for your tours, destinations and journal. Upload once, use anywhere on your website."
        actions={
          canManage ? (
            <button type="button" className="btn btn-outline" onClick={() => setFolderDialog({ mode: "create" })}>
              <FolderPlus aria-hidden="true" />
              New folder
            </button>
          ) : null
        }
      />

      {storage !== "ready" ? (
        <div role="status" className="alert alert-warning mb-6 flex flex-wrap items-center justify-between gap-3">
          <span>
            {storage === "missing"
              ? "No storage is connected, so new files cannot be uploaded. The files below stay available."
              : (storageMessage ?? "The storage connection is not working, so new files cannot be uploaded.")}
          </span>
          {canConnect ? (
            <Link href="/workspace/settings/integrations" className="btn btn-outline btn-sm">
              Open integrations
            </Link>
          ) : null}
        </div>
      ) : null}

      <section aria-label="Storage" className="card mb-6 flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm">
            <span className="font-display text-2xl font-semibold text-primary">{formatBytes(usage.usedBytes)}</span>{" "}
            <span className="text-muted-foreground">
              {usage.limitMb === null ? "used · no storage limit on your plan" : `of ${formatBytes(usage.limitMb * 1024 * 1024)} used`}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            {usage.assetCount} {usage.assetCount === 1 ? "file" : "files"}
          </p>
        </div>
        {percent !== null ? (
          <>
            <div className="progress" role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
              <div className={cn("h-full rounded-full", percent >= 90 ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.max(percent, usage.usedBytes > 0 ? 1 : 0)}%` }} />
            </div>
            {percent >= 90 ? (
              <p className="text-[13px] text-muted-foreground">
                {percent >= 100 ? "Your storage is full." : "Your storage is almost full."} Delete files you no longer use, or{" "}
                <Link href="/workspace/billing" className="font-semibold text-primary underline-offset-4 hover:underline">
                  see plans with more storage
                </Link>
                .
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <div className="mb-4 flex flex-col gap-3">
        <div role="group" aria-label="Folder" className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0">
          <button type="button" className="chip h-9 shrink-0 px-3.5 text-[13px]" aria-pressed={filters.folder === "all"} onClick={() => change({ folder: "all" })}>
            All files · {usage.assetCount}
          </button>
          {folders.length > 0 ? (
            <button type="button" className="chip h-9 shrink-0 px-3.5 text-[13px]" aria-pressed={filters.folder === "none"} onClick={() => change({ folder: "none" })}>
              No folder
            </button>
          ) : null}
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="chip h-9 shrink-0 px-3.5 text-[13px]"
              aria-pressed={filters.folder === folder.id}
              onClick={() => change({ folder: folder.id })}
            >
              {folder.name} · {folder.assetCount}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative block sm:w-72">
              <span className="sr-only">Search files</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
              <input
                type="search"
                className="input pl-9"
                placeholder="Search by file name or description"
                value={filters.search}
                onChange={(event) => change({ search: event.target.value }, true)}
              />
            </label>
            <div role="group" aria-label="File type" className="flex gap-2">
              {kinds.map((kind) => (
                <button key={kind.value} type="button" className="chip h-9 px-3.5 text-[13px]" aria-pressed={filters.kind === kind.value} onClick={() => change({ kind: kind.value })}>
                  {kind.label}
                </button>
              ))}
            </div>
          </div>
          {currentFolder && canManage ? (
            <div className="flex gap-2">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setFolderDialog({ mode: "rename", folder: currentFolder })}>
                <Pencil aria-hidden="true" />
                Rename folder
              </button>
              <button type="button" className="btn btn-ghost btn-sm text-destructive hover:text-destructive" onClick={() => setFolderToDelete(currentFolder)}>
                <Trash2 aria-hidden="true" />
                Delete folder
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {canUpload ? (
        <div className="mb-6 flex flex-col gap-3">
          <Dropzone onFiles={(files) => uploads.add(files)} />
          {currentFolder ? <p className="field-hint">New files go into “{currentFolder.name}”.</p> : null}
          <UploadList entries={uploads.entries} onRetry={uploads.retry} onDismiss={uploads.dismiss} onClearFinished={uploads.clearFinished} />
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="alert alert-destructive mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void load(filters)}>
            Try again
          </button>
        </div>
      ) : null}

      {loading ? (
        <div aria-busy="true" aria-label="Loading files" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, index) => (
            <div key={index} className="skeleton aspect-square" />
          ))}
        </div>
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No files match"
            description={filters.search.trim() ? `Nothing in this view matches “${filters.search.trim()}”.` : "There are no files in this view yet."}
            action={
              <button type="button" className="btn btn-outline" onClick={() => change(NO_FILTERS)}>
                Show all files
              </button>
            }
          />
        ) : (
          <EmptyState
            title="No media yet"
            description={
              canUpload
                ? "Upload photos and videos above. They become available to your tours, destinations and journal straight away."
                : "Files uploaded by your team will appear here."
            }
          />
        )
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(item.id)}
                  className="card group block w-full overflow-hidden text-left outline-none transition-[box-shadow,transform] duration-150 ease-out hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/60 active:scale-[0.98]"
                >
                  <MediaThumb
                    media={item}
                    alt={item.alt}
                    eager={index < 5}
                    className="aspect-square w-full rounded-none"
                    sizes="(min-width: 1280px) 18vw, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 46vw"
                  />
                  <span className="block p-3">
                    <span className="block truncate text-sm font-semibold">{mediaLabel(item)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.format.toUpperCase()}
                      {item.resourceType === "video" && item.durationSeconds ? ` · ${formatDuration(item.durationSeconds)}` : item.width && item.height ? ` · ${item.width} × ${item.height}` : ""}
                      {` · ${formatBytes(item.bytes)}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {nextCursor ? (
            <div className="mt-6 flex justify-center">
              <button type="button" className="btn btn-outline" disabled={loadingMore} aria-busy={loadingMore || undefined} onClick={() => void loadMore()}>
                {loadingMore ? <Spinner /> : null}
                Load more
              </button>
            </div>
          ) : null}
        </>
      )}

      <AssetPanel
        item={openItem}
        folders={folders}
        canManage={canManage}
        timezone={timezone}
        onClose={() => setOpenId(null)}
        onChanged={(changed) => setItems((current) => current.map((item) => (item.id === changed.id ? changed : item)))}
        onDeleted={(id) => setItems((current) => current.filter((item) => item.id !== id))}
      />

      {folderDialog ? (
        <FolderDialog
          key={folderDialog.mode === "rename" ? folderDialog.folder.id : "create"}
          dialog={folderDialog}
          onClose={() => setFolderDialog(null)}
          onCreated={(folder) => change({ folder: folder.id })}
        />
      ) : null}

      <ConfirmDialog
        open={folderToDelete !== null}
        onOpenChange={(open) => (open ? undefined : setFolderToDelete(null))}
        title={`Delete the folder “${folderToDelete?.name ?? ""}”?`}
        description={
          folderToDelete && folderToDelete.assetCount > 0
            ? `Its ${folderToDelete.assetCount === 1 ? "file stays" : `${folderToDelete.assetCount} files stay`} in your library, without a folder.`
            : "The folder is empty. Nothing else changes."
        }
        confirmLabel="Delete folder"
        cancelLabel="Keep it"
        destructive
        pending={removeFolder.pending}
        onConfirm={() => (folderToDelete ? void removeFolder.run({ id: folderToDelete.id }) : undefined)}
      />
    </>
  );
}

// Immediate feedback only; the server validates again with its own schema.
const folderFormSchema = z.object({
  name: z.string().trim().min(1, "Give the folder a name.").max(80, "Keep the folder name under 80 characters."),
});
type FolderValues = z.infer<typeof folderFormSchema>;

interface FolderDialogProps {
  dialog: { mode: "create" } | { mode: "rename"; folder: MediaFolderItem };
  onClose: () => void;
  onCreated: (folder: MediaFolderItem) => void;
}

function FolderDialog({ dialog, onClose, onCreated }: FolderDialogProps) {
  const renaming = dialog.mode === "rename" ? dialog.folder : null;
  const form = useForm<FolderValues>({ resolver: zodResolver(folderFormSchema), defaultValues: { name: renaming?.name ?? "" } });
  const create = useAction(createFolderAction, {
    success: "Folder created",
    toastError: false,
    onSuccess: (folder) => {
      onCreated(folder);
      onClose();
    },
  });
  const rename = useAction(renameFolderAction, { success: "Folder renamed", toastError: false, onSuccess: onClose });
  const action = renaming ? rename : create;
  const message = form.formState.errors.name?.message ?? firstError(action.fieldErrors, "name") ?? (action.error && !action.fieldErrors ? action.error : null);

  return (
    <Modal open onOpenChange={(open) => (open ? undefined : onClose())} title={renaming ? "Rename folder" : "New folder"} description="Folders only organise your library. Moving a file never breaks where it is used.">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => void (renaming ? rename.run({ id: renaming.id, name: values.name }) : create.run({ name: values.name })))}
      >
        <Field label="Folder name" error={message}>
          {(control) => <input {...control} {...form.register("name")} className="input" autoComplete="off" autoFocus />}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <SubmitButton pending={action.pending} pendingLabel="Saving…">
            {renaming ? "Rename folder" : "Create folder"}
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
