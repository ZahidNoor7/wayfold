"use client";

/**
 * Media picker — choose files from the workspace's media library.
 *
 * ```tsx
 * import { MediaPicker, MediaThumb, type MediaItem } from "@/components/workspace/media/media-picker";
 *
 * const [open, setOpen] = useState(false);
 * const [cover, setCover] = useState<MediaItem | null>(null);
 *
 * <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>Choose image</button>
 * <MediaThumb media={cover} className="aspect-[4/3] w-40" sizes="160px" />
 * <MediaPicker
 *   open={open}
 *   onOpenChange={setOpen}
 *   resourceType="image"
 *   selectedIds={cover ? [cover.id] : []}
 *   onSelect={([asset]) => setCover(asset ?? null)}
 * />
 * ```
 *
 * `MediaPicker` props
 * - `open`, `onOpenChange(open)` — controlled, like every overlay in `@/components/overlays`.
 * - `multiple?` — pick several files (default: one). The order of `onSelect`'s array is the order
 *   they were chosen in, with files that were already selected first, in their existing order.
 * - `resourceType?` — `"image"` or `"video"` to show and accept only that kind (default: both).
 * - `selectedIds?` — ids selected when the picker opens. Read once per opening.
 * - `onSelect(assets)` — called with the full selection (`MediaItem[]`, possibly empty) when the
 *   person confirms. The picker then closes itself. Cancelling calls nothing.
 * - `max?` — most files that can be selected when `multiple` (default 60, a tour gallery's limit).
 * - `title?` — heading of the panel (default "Choose a file" / "Choose files").
 * - `canUpload?` — show the inline upload area (default true). Pass `can(workspace, "media.manage")`;
 *   the server refuses uploads from members without that permission either way.
 *
 * Data comes from the Server Actions in `./actions` (`listMediaAction`, permission `media.view`),
 * so the picker works on any workspace page without extra props. Uploaded files are added to the
 * library and selected straight away.
 *
 * `MediaThumb` props (`./media-thumb`)
 * - `media` — `{ url, alt?, resourceType? } | null`. Any object with those fields works: a
 *   `MediaItem`, a tour gallery item, or `{ url: coverUrl }`. `null` renders a placeholder.
 * - `className` — size and shape of the box (the image is cropped to cover it), e.g. `h-11 w-16`.
 * - `sizes?` — next/image `sizes` (default `"160px"`); `alt?` — overrides the file's description;
 *   `eager?` — load without lazy-loading.
 *
 * `MediaItem` (`./types`): `{ id, url, alt, resourceType, format, bytes, width, height,
 * durationSeconds, originalFilename, folderId, createdAt }`.
 */

import { Check, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Panel, Spinner } from "@/components/overlays";
import type { MediaKind } from "@/lib/media-upload";
import { cn } from "@/lib/utils";
import { getMediaByIdsAction, listFoldersAction, listMediaAction } from "./actions";
import { MediaThumb } from "./media-thumb";
import { mediaLabel, type MediaFolderItem, type MediaItem } from "./types";
import { Dropzone, UploadList } from "./upload-ui";
import { useMediaUploads } from "./use-media-uploads";

export { MediaThumb, type MediaThumbProps } from "./media-thumb";
export type { MediaItem } from "./types";

export interface MediaPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  multiple?: boolean;
  resourceType?: MediaKind;
  selectedIds?: string[];
  onSelect: (assets: MediaItem[]) => void;
  max?: number;
  title?: string;
  canUpload?: boolean;
}

export function MediaPicker({ open, onOpenChange, multiple = false, title, ...rest }: MediaPickerProps) {
  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? (multiple ? "Choose files" : "Choose a file")}
      description="From your media library. New uploads are added to the library."
      className="sm:max-w-2xl"
    >
      {/* Mounted per opening, so each one starts from the caller's current selection. */}
      {open ? <PickerBody multiple={multiple} onClose={() => onOpenChange(false)} {...rest} /> : null}
    </Panel>
  );
}

const PAGE_SIZE = 30;
type KindFilter = "all" | MediaKind;
/** "all" = every file, "none" = files in no folder, otherwise a folder id. */
type FolderFilter = string;

interface Filters {
  search: string;
  kind: KindFilter;
  folder: FolderFilter;
}

function toQuery(filters: Filters, cursor?: string) {
  return {
    limit: PAGE_SIZE,
    ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
    ...(filters.kind !== "all" ? { resourceType: filters.kind } : {}),
    ...(filters.folder === "none" ? { folderId: null } : filters.folder !== "all" ? { folderId: filters.folder } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

interface BodyProps extends Omit<MediaPickerProps, "open" | "onOpenChange" | "title"> {
  multiple: boolean;
  onClose: () => void;
}

function PickerBody({ multiple, resourceType, selectedIds, onSelect, max = 60, canUpload = true, onClose }: BodyProps) {
  const [initialIds] = useState(() => selectedIds ?? []);
  const [filters, setFilters] = useState<Filters>({ search: "", kind: resourceType ?? "all", folder: "all" });
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [folders, setFolders] = useState<MediaFolderItem[]>([]);
  const [selected, setSelected] = useState<string[]>(initialIds);
  // Every file seen so far, so the selection survives changing filters.
  const [known, setKnown] = useState<Record<string, MediaItem>>({});
  const [limitNote, setLimitNote] = useState(false);

  const request = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const remember = (list: MediaItem[]) => setKnown((current) => ({ ...current, ...Object.fromEntries(list.map((item) => [item.id, item])) }));

  async function load(next: Filters) {
    const ticket = ++request.current;
    setState("loading");
    setError(null);
    const result = await listMediaAction(toQuery(next)).catch(() => null);
    if (ticket !== request.current) return;
    if (!result || !result.ok) {
      setState("error");
      setError(result?.error ?? "We could not reach the server. Check your connection and try again.");
      return;
    }
    setItems(result.data.items);
    setNextCursor(result.data.nextCursor);
    remember(result.data.items);
    setState("ready");
  }

  useEffect(() => {
    let cancelled = false;
    const ticket = ++request.current;
    void (async () => {
      const first = { search: "", kind: resourceType ?? ("all" as const), folder: "all" };
      const [page, folderList, preselected] = await Promise.all([
        listMediaAction(toQuery(first)).catch(() => null),
        listFoldersAction({}).catch(() => null),
        initialIds.length > 0 ? getMediaByIdsAction({ ids: initialIds.slice(0, 60) }).catch(() => null) : null,
      ]);
      if (cancelled || ticket !== request.current) return;
      if (folderList?.ok) setFolders(folderList.data);
      if (preselected?.ok) {
        const found = preselected.data;
        setKnown((current) => ({ ...current, ...Object.fromEntries(found.map((item) => [item.id, item])) }));
        // Files deleted since they were chosen drop out of the selection.
        setSelected((current) => current.filter((id) => found.some((item) => item.id === id) || !initialIds.includes(id)));
      }
      if (!page || !page.ok) {
        setState("error");
        setError(page?.error ?? "We could not reach the server. Check your connection and try again.");
        return;
      }
      setItems(page.data.items);
      setNextCursor(page.data.nextCursor);
      setKnown((current) => ({ ...current, ...Object.fromEntries(page.data.items.map((item) => [item.id, item])) }));
      setState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [initialIds, resourceType]);

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

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
    remember(result.data.items);
  }

  function toggle(id: string) {
    setLimitNote(false);
    if (!multiple) {
      setSelected((current) => (current[0] === id ? [] : [id]));
      return;
    }
    if (selected.includes(id)) setSelected(selected.filter((other) => other !== id));
    else if (selected.length >= max) setLimitNote(true);
    else setSelected([...selected, id]);
  }

  const uploads = useMediaUploads({
    folderId: filters.folder !== "all" && filters.folder !== "none" ? filters.folder : null,
    onUploaded: (item) => {
      setKnown((current) => ({ ...current, [item.id]: item }));
      setItems((current) => (current.some((existing) => existing.id === item.id) ? current : [item, ...current]));
      setSelected((current) => (!multiple ? [item.id] : current.includes(item.id) || current.length >= max ? current : [...current, item.id]));
    },
  });

  const chosen = selected.map((id) => known[id]).filter((item): item is MediaItem => Boolean(item));
  const kinds: { value: KindFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "image", label: "Images" },
    { value: "video", label: "Videos" },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative block flex-1">
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
          {folders.length > 0 ? (
            <label className="sm:w-44">
              <span className="sr-only">Folder</span>
              <select className="select" value={filters.folder} onChange={(event) => change({ folder: event.target.value })}>
                <option value="all">All folders</option>
                <option value="none">No folder</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {resourceType ? null : (
          <div role="group" aria-label="File type" className="flex flex-wrap gap-2">
            {kinds.map((kind) => (
              <button key={kind.value} type="button" className="chip h-9 px-3.5 text-[13px]" aria-pressed={filters.kind === kind.value} onClick={() => change({ kind: kind.value })}>
                {kind.label}
              </button>
            ))}
          </div>
        )}

        {canUpload ? (
          <>
            <Dropzone compact only={resourceType} multiple={multiple} onFiles={(files) => uploads.add(multiple ? files : files.slice(0, 1), resourceType)} />
            <UploadList entries={uploads.entries} onRetry={uploads.retry} onDismiss={uploads.dismiss} onClearFinished={uploads.clearFinished} />
          </>
        ) : null}

        {error ? (
          <div role="alert" className="alert alert-destructive flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void (state === "error" ? load(filters) : loadMore())}>
              Try again
            </button>
          </div>
        ) : null}

        {state === "loading" ? (
          <div aria-busy="true" aria-label="Loading files" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 12 }, (_, index) => (
              <div key={index} className="skeleton aspect-square" />
            ))}
          </div>
        ) : state === "ready" && items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="font-semibold">{filters.search.trim() || filters.kind !== (resourceType ?? "all") || filters.folder !== "all" ? "No files match" : "Your library is empty"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filters.search.trim() || filters.folder !== "all" ? "Try another search or folder." : canUpload ? "Upload a file above to use it here." : "Ask someone who manages media to upload files."}
            </p>
          </div>
        ) : state === "ready" ? (
          <>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((item) => {
                const position = selected.indexOf(item.id);
                const isSelected = position >= 0;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={mediaLabel(item)}
                      title={mediaLabel(item)}
                      onClick={() => toggle(item.id)}
                      className={cn(
                        "relative block w-full overflow-hidden rounded-lg outline-none transition-transform duration-100 ease-out active:scale-[0.97]",
                        "focus-visible:ring-[3px] focus-visible:ring-ring/60",
                        isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                      )}
                    >
                      <MediaThumb media={item} alt="" className="aspect-square w-full rounded-none" sizes="(min-width: 640px) 150px, 33vw" />
                      {isSelected ? (
                        <span aria-hidden="true" className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow">
                          {multiple ? position + 1 : <Check className="size-3.5" />}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {nextCursor ? (
              <button type="button" className="btn btn-outline self-center" disabled={loadingMore} aria-busy={loadingMore || undefined} onClick={() => void loadMore()}>
                {loadingMore ? <Spinner /> : null}
                Load more
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="safe-b sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-background px-5 pt-3 sm:px-6">
        <p className="text-sm text-muted-foreground" role="status">
          {limitNote ? `You can choose up to ${max} files.` : chosen.length === 0 ? "Nothing selected" : multiple ? `${chosen.length} selected` : mediaLabel(chosen[0]!)}
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-default"
            disabled={uploads.busy}
            onClick={() => {
              onSelect(chosen);
              onClose();
            }}
          >
            {multiple ? (chosen.length > 0 ? `Use ${chosen.length} ${chosen.length === 1 ? "file" : "files"}` : "Use no files") : chosen.length > 0 ? "Use this file" : "Use no file"}
          </button>
        </div>
      </footer>
    </div>
  );
}
