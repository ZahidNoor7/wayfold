"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, RefreshCw, Trash2 } from "lucide-react";
import Image from "next/image";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Field, firstError, FormError, SubmitButton } from "@/components/form";
import { ConfirmDialog, Panel, Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { acceptAttribute, describeAllowed, formatBytes, formatDuration, uploadMediaFile, videoPosterUrl } from "@/lib/media-upload";
import { createUploadSignatureAction, deleteMediaAction, replaceMediaAction, updateMediaAction } from "./actions";
import { mediaLabel, type MediaFolderItem, type MediaItem } from "./types";

// Immediate feedback only; the server validates again with its own schema.
const detailsSchema = z.object({
  alt: z.string().trim().max(300, "Keep the description under 300 characters."),
  folderId: z.string(),
});
type DetailsValues = z.infer<typeof detailsSchema>;

interface AssetPanelProps {
  /** The file being inspected; `null` closes the panel. */
  item: MediaItem | null;
  folders: MediaFolderItem[];
  canManage: boolean;
  timezone: string;
  onClose: () => void;
  onChanged: (item: MediaItem) => void;
  onDeleted: (id: string) => void;
}

export function AssetPanel({ item, onClose, ...rest }: AssetPanelProps) {
  return (
    <Panel open={item !== null} onOpenChange={(open) => (open ? undefined : onClose())} title={item ? mediaLabel(item) : "File"} description="File details">
      {/* Keyed by file and stored URL, so the form and preview restart after a replacement. */}
      {item ? <AssetDetails key={`${item.id}:${item.url}`} item={item} onClose={onClose} {...rest} /> : null}
    </Panel>
  );
}

function AssetDetails({ item, folders, canManage, timezone, onClose, onChanged, onDeleted }: Omit<AssetPanelProps, "item"> & { item: MediaItem }) {
  const replaceInputId = useId();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [replacing, setReplacing] = useState<{ phase: "sending" | "processing"; fraction: number } | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);

  const form = useForm<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { alt: item.alt, folderId: item.folderId ?? "" },
  });
  const { errors, isDirty } = form.formState;

  const save = useAction(updateMediaAction, {
    success: "File details saved",
    toastError: false,
    onSuccess: (saved) => {
      form.reset({ alt: saved.alt, folderId: saved.folderId ?? "" });
      onChanged(saved);
    },
  });
  const remove = useAction(deleteMediaAction, {
    success: "File deleted",
    toastError: false,
    onSuccess: () => {
      setConfirmDelete(false);
      onDeleted(item.id);
      onClose();
    },
  });

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(item.url);
      toast.success("Copied");
    } catch {
      toast.error("Your browser blocked copying. Select the address and copy it manually.");
    }
  }

  async function replaceWith(file: File) {
    setReplaceError(null);
    setReplacing({ phase: "sending", fraction: 0 });
    const outcome = await uploadMediaFile<MediaItem>(file, {
      only: item.resourceType,
      steps: {
        sign: createUploadSignatureAction,
        complete: ({ publicId, resourceType, filename }) => replaceMediaAction({ id: item.id, publicId, resourceType, filename }),
      },
      onProgress: (phase, fraction) => setReplacing({ phase, fraction }),
    });
    setReplacing(null);
    if (outcome.ok) {
      toast.success("File replaced");
      onChanged(outcome.asset);
    } else {
      setReplaceError(outcome.reason);
    }
  }

  const uploaded = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(item.createdAt));
  const facts: [string, string][] = [
    ["Type", `${item.resourceType === "video" ? "Video" : "Image"}${item.format ? ` · ${item.format.toUpperCase()}` : ""}`],
    ...(item.width && item.height ? ([["Dimensions", `${item.width} × ${item.height} px`]] as [string, string][]) : []),
    ...(item.durationSeconds ? ([["Length", formatDuration(item.durationSeconds)]] as [string, string][]) : []),
    ["Size", formatBytes(item.bytes)],
    ["Uploaded", uploaded],
    ...(item.originalFilename ? ([["File name", item.originalFilename]] as [string, string][]) : []),
  ];
  const message = (name: keyof DetailsValues) => errors[name]?.message ?? firstError(save.fieldErrors, name);

  return (
    <div className="flex flex-col gap-6 p-5 sm:p-6">
      <div className="overflow-hidden rounded-lg border bg-muted">
        {item.resourceType === "video" ? (
          <video controls preload="metadata" poster={videoPosterUrl(item.url)} aria-label={item.alt || mediaLabel(item)} className="max-h-[60vh] w-full bg-black">
            <source src={item.url} />
          </video>
        ) : item.width && item.height ? (
          <Image
            src={item.url}
            alt={item.alt}
            width={item.width}
            height={item.height}
            sizes="(min-width: 640px) 528px, 100vw"
            className="mx-auto h-auto max-h-[60vh] w-auto max-w-full object-contain"
          />
        ) : (
          <div className="relative aspect-[4/3]">
            <Image src={item.url} alt={item.alt} fill sizes="(min-width: 640px) 528px, 100vw" className="object-contain" />
          </div>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {facts.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="min-w-0 break-words font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2">
        <span className="label">Address</span>
        <div className="flex gap-2">
          <input className="input min-w-0 flex-1 font-mono text-xs sm:text-xs" readOnly value={item.url} aria-label="File address" onFocus={(event) => event.currentTarget.select()} />
          <button type="button" className="btn btn-outline h-11 shrink-0" onClick={() => void copyUrl()}>
            <Copy aria-hidden="true" />
            Copy
          </button>
        </div>
      </div>

      {canManage ? (
        <>
          <form
            noValidate
            className="flex flex-col gap-4 border-t pt-6"
            onSubmit={form.handleSubmit((values) => void save.run({ id: item.id, alt: values.alt, folderId: values.folderId || null }))}
          >
            <FormError message={save.error && !save.fieldErrors ? save.error : null} />
            <Field
              label="Description"
              note="alt text"
              hint="Say what the picture shows. Screen readers read it aloud, and search engines use it."
              error={message("alt")}
            >
              {(control) => <textarea {...control} {...form.register("alt")} className="textarea" rows={3} />}
            </Field>
            <Field label="Folder" error={message("folderId")}>
              {(control) => (
                <select {...control} {...form.register("folderId")} className="select">
                  <option value="">No folder</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div>
              <SubmitButton pending={save.pending} pendingLabel="Saving…" disabled={!isDirty}>
                Save details
              </SubmitButton>
            </div>
          </form>

          <section aria-label="Replace or delete" className="flex flex-col gap-3 border-t pt-6">
            <p className="text-sm text-muted-foreground">
              Replacing keeps this file wherever it is used and swaps in a new {item.resourceType}. {describeAllowed(item.resourceType)}.
            </p>
            {replacing ? (
              <div className="flex flex-col gap-2" role="status">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Spinner className="size-4" />
                  {replacing.phase === "sending" ? `Uploading ${Math.round(replacing.fraction * 100)}%` : "Checking the file"}
                </p>
                <div className="progress h-1.5">
                  <div
                    className="h-full origin-left rounded-full bg-primary transition-transform duration-200 ease-out"
                    style={{ transform: `scaleX(${replacing.phase === "processing" ? 1 : replacing.fraction})` }}
                  />
                </div>
              </div>
            ) : null}
            {replaceError ? (
              <p role="alert" className="alert alert-destructive">
                {replaceError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <label htmlFor={replaceInputId} className="btn btn-outline cursor-pointer has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50" aria-disabled={replacing ? true : undefined}>
                <RefreshCw aria-hidden="true" />
                Replace file
                <input
                  id={replaceInputId}
                  type="file"
                  className="sr-only"
                  accept={acceptAttribute(item.resourceType)}
                  disabled={replacing !== null}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void replaceWith(file);
                  }}
                />
              </label>
              <button type="button" className="btn btn-ghost text-destructive hover:text-destructive" disabled={replacing !== null} onClick={() => { remove.reset(); setConfirmDelete(true); }}>
                <Trash2 aria-hidden="true" />
                Delete file
              </button>
            </div>
          </section>
        </>
      ) : item.alt ? (
        <div className="border-t pt-6">
          <p className="label">Description</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.alt}</p>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${mediaLabel(item)}”?`}
        description={
          <>
            <p>This removes the file from your library and from any tour or journal gallery that shows it. This can’t be undone.</p>
            {remove.error ? (
              <p role="alert" className="alert alert-destructive mt-3">
                {remove.error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete file"
        cancelLabel="Keep it"
        destructive
        pending={remove.pending}
        onConfirm={() => void remove.run({ id: item.id })}
      />
    </div>
  );
}
