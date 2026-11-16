"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { UploadQueue, uploadMediaFile, type MediaKind, type UploadEntry } from "@/lib/media-upload";
import { createUploadSignatureAction, finalizeUploadAction } from "./actions";
import type { MediaItem } from "./types";

interface Options {
  /** Folder new uploads are filed under. */
  folderId?: string | null;
  /** Called once per file that reached the library. */
  onUploaded: (item: MediaItem) => void;
}

const NO_ENTRIES: UploadEntry[] = [];

function createQueue() {
  return new UploadQueue<MediaItem>((file, onProgress, folderId) =>
    uploadMediaFile<MediaItem>(file, {
      steps: { sign: createUploadSignatureAction, complete: finalizeUploadAction },
      folderId,
      onProgress,
    }),
  );
}

/**
 * The upload list for one screen: add files, watch each one's progress, retry
 * the ones that failed. Each file is signed by the server, sent straight to
 * storage, then verified and recorded by the server.
 */
export function useMediaUploads({ folderId = null, onUploaded }: Options) {
  const [queue] = useState(createQueue);
  // The queue outlives renders, so hand it the newest callback after each one.
  useEffect(() => {
    queue.setUploadedHandler(onUploaded);
  });

  const entries = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => NO_ENTRIES);

  return {
    entries,
    busy: entries.some((entry) => entry.status === "queued" || entry.status === "sending" || entry.status === "processing"),
    add: (files: readonly File[], only?: MediaKind) => queue.add(files, only, folderId),
    retry: (key: string) => queue.retry(key),
    dismiss: (key: string) => queue.dismiss(key),
    clearFinished: () => queue.clearFinished(),
  };
}
