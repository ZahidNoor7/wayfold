"use client";

import { AlertCircle, Check, RotateCw, Upload, X } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";
import { Spinner } from "@/components/overlays";
import { acceptAttribute, describeAllowed, formatBytes, type MediaKind, type UploadEntry } from "@/lib/media-upload";
import { cn } from "@/lib/utils";

interface DropzoneProps {
  onFiles: (files: File[]) => void;
  /** Restrict the picker and the hint to one kind of file. */
  only?: MediaKind;
  multiple?: boolean;
  disabled?: boolean;
  /** A shorter block for tight spaces such as the picker. */
  compact?: boolean;
  className?: string;
}

/** The design's dashed drop area: drop files on it, or activate it to browse. */
export function Dropzone({ onFiles, only, multiple = true, disabled, compact, className }: DropzoneProps) {
  const inputId = useId();
  const hintId = useId();
  const [over, setOver] = useState(false);
  // dragenter/dragleave fire for every child; count them to know when the pointer really left.
  const depth = useRef(0);

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    <label
      htmlFor={inputId}
      onDragEnter={(event) => {
        event.preventDefault();
        depth.current += 1;
        if (!disabled) setOver(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={handleDrop}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border-2 border-dashed bg-muted/40 text-center text-sm text-muted-foreground transition-colors",
        "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/25",
        compact ? "p-4" : "p-6",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted",
        over && "border-primary bg-primary/5 text-foreground",
        className,
      )}
    >
      <Upload aria-hidden="true" className="size-5" />
      <span>
        {over ? (
          "Drop to upload"
        ) : (
          <>
            Drag {only === "video" ? "videos" : only === "image" ? "photos" : "files"} here or <span className="font-semibold text-primary underline">browse</span>
          </>
        )}
      </span>
      <span id={hintId} className="text-xs">
        {describeAllowed(only)}
      </span>
      <input
        id={inputId}
        type="file"
        className="sr-only"
        accept={acceptAttribute(only)}
        multiple={multiple}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Reset so choosing the same file again fires a change.
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </label>
  );
}

const STATUS_TEXT: Record<UploadEntry["status"], string> = {
  queued: "Waiting",
  sending: "Uploading",
  processing: "Checking the file",
  done: "Uploaded",
  error: "Not uploaded",
};

interface UploadListProps {
  entries: UploadEntry[];
  onRetry: (key: string) => void;
  onDismiss: (key: string) => void;
  onClearFinished?: () => void;
  className?: string;
}

/** One row per file: progress while it travels, then the result, with the reason and a retry on failure. */
export function UploadList({ entries, onRetry, onDismiss, onClearFinished, className }: UploadListProps) {
  if (entries.length === 0) return null;
  const finished = entries.filter((entry) => entry.status === "done").length;
  const failed = entries.filter((entry) => entry.status === "error").length;
  const active = entries.length - finished - failed;

  return (
    <section aria-label="Uploads" className={cn("card overflow-hidden", className)}>
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <p className="text-sm font-semibold" role="status">
          {active > 0 ? `Uploading ${active} ${active === 1 ? "file" : "files"}` : failed > 0 ? `${failed} ${failed === 1 ? "file was" : "files were"} not uploaded` : `${finished} ${finished === 1 ? "file" : "files"} uploaded`}
        </p>
        {finished > 0 && onClearFinished ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClearFinished}>
            Clear finished
          </button>
        ) : null}
      </header>
      <ul className="divide-y">
        {entries.map((entry) => {
          const percent = Math.round(entry.progress * 100);
          const working = entry.status === "sending" || entry.status === "processing";
          return (
            <li key={entry.key} className="flex items-start gap-3 px-4 py-3">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center",
                  entry.status === "done" && "text-success",
                  entry.status === "error" && "text-destructive",
                  (working || entry.status === "queued") && "text-muted-foreground",
                )}
              >
                {entry.status === "done" ? <Check className="size-4" /> : entry.status === "error" ? <AlertCircle className="size-4" /> : <Spinner className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-semibold">{entry.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {entry.status === "sending" ? `${percent}%` : STATUS_TEXT[entry.status]} · {formatBytes(entry.size)}
                  </span>
                </p>
                {working || entry.status === "queued" ? (
                  <div
                    className="progress mt-2 h-1.5"
                    role="progressbar"
                    aria-label={`${STATUS_TEXT[entry.status]}: ${entry.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={entry.status === "processing" ? 100 : percent}
                  >
                    <div
                      className={cn("h-full origin-left rounded-full bg-primary transition-transform duration-200 ease-out", entry.status === "processing" && "animate-pulse")}
                      style={{ transform: `scaleX(${entry.status === "processing" ? 1 : entry.progress})` }}
                    />
                  </div>
                ) : null}
                {entry.status === "error" && entry.reason ? (
                  <p role="alert" className="field-error mt-1">
                    {entry.reason}
                  </p>
                ) : null}
              </div>
              {entry.status === "error" && entry.retryable ? (
                <button type="button" className="btn btn-outline btn-sm shrink-0" onClick={() => onRetry(entry.key)}>
                  <RotateCw aria-hidden="true" />
                  Retry
                </button>
              ) : null}
              {entry.status === "error" || entry.status === "done" || entry.status === "queued" ? (
                <button type="button" className="btn btn-ghost btn-icon btn-sm shrink-0" aria-label={`Remove ${entry.name} from this list`} onClick={() => onDismiss(entry.key)}>
                  <X aria-hidden="true" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
