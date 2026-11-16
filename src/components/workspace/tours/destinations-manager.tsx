"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ImagePlus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { createDestinationAction, deleteDestinationAction, reorderDestinationsAction, updateDestinationAction } from "@/app/workspace/destinations/actions";
import { Field, firstError, FormError, SubmitButton } from "@/components/form";
import { ConfirmDialog, Panel } from "@/components/overlays";
import { MediaPicker, MediaThumb } from "@/components/workspace/media/media-picker";
import { EmptyState, PageHeader } from "@/components/workspace/page-header";
import { useAction } from "@/hooks/use-action";
import { MoveButtons, ToggleRow } from "./editor-parts";
import { moveItem, parseCoordinate, slugFromTitle } from "./tour-form-model";

export interface DestinationItem {
  id: string;
  name: string;
  slug: string;
  region: string;
  tagline: string;
  description: string;
  coverMediaId: string | null;
  coverUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  isPublished: boolean;
  tourCount: number;
}

interface DestinationsManagerProps {
  destinations: DestinationItem[];
  canPickMedia: boolean;
  canUploadMedia: boolean;
}

export function DestinationsManager({ destinations, canPickMedia, canUploadMedia }: DestinationsManagerProps) {
  // The server's order, until a move is made here; then the local order until the page refreshes.
  const [order, setOrder] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<DestinationItem | "new" | null>(null);
  const [toDelete, setToDelete] = useState<DestinationItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const reorder = useAction(reorderDestinationsAction);
  const publish = useAction(updateDestinationAction);
  const remove = useAction(deleteDestinationAction, { toastError: false });

  const byId = new Map(destinations.map((destination) => [destination.id, destination]));
  const known = order?.filter((id) => byId.has(id)) ?? [];
  const list = order ? [...known.map((id) => byId.get(id) as DestinationItem), ...destinations.filter((destination) => !known.includes(destination.id))] : destinations;

  async function move(index: number, to: number) {
    const next = moveItem(list, index, to).map((destination) => destination.id);
    const moved = list[index] as DestinationItem;
    setOrder(next);
    setAnnouncement(`${moved.name} moved to position ${to + 1} of ${list.length}.`);
    const result = await reorder.run({ orderedIds: next });
    if (!result.ok) {
      setOrder(null);
      setAnnouncement("The order could not be saved.");
    }
  }

  async function setPublished(destination: DestinationItem, isPublished: boolean) {
    setBusy(destination.id);
    const result = await publish.run({ id: destination.id, destination: { isPublished } });
    setBusy(null);
    if (result.ok) toast.success(isPublished ? `“${destination.name}” is on your website` : `“${destination.name}” hidden from your website`);
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const result = await remove.run({ id: toDelete.id });
    if (result.ok) {
      toast.success(`Deleted ${toDelete.name}`);
      setOrder(null);
      setToDelete(null);
    }
  }

  const publishedSwitch = (destination: DestinationItem) => (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={destination.isPublished}
      aria-label={`Published: ${destination.name}`}
      disabled={busy === destination.id}
      onClick={() => void setPublished(destination, !destination.isPublished)}
    >
      <span className="switch-thumb" />
    </button>
  );

  const actionsFor = (destination: DestinationItem, index: number) => (
    <span className="inline-flex items-center gap-1">
      <MoveButtons label={destination.name} index={index} count={list.length} onMove={(to) => void move(index, to)} />
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(destination)}>
        Edit
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm text-destructive hover:text-destructive"
        aria-label={`Delete ${destination.name}`}
        onClick={() => {
          remove.reset();
          setToDelete(destination);
        }}
      >
        <Trash2 aria-hidden="true" />
      </button>
    </span>
  );

  const tourCountText = (count: number) => (count === 0 ? "No tours" : `${count} ${count === 1 ? "tour" : "tours"}`);

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <Link href="/workspace/tours" className="btn btn-link mb-2 h-auto px-0 py-1">
        <ArrowLeft aria-hidden="true" />
        Tours
      </Link>
      <PageHeader
        title="Destinations"
        description="The places your tours go. Published destinations appear on your website, in the order shown here."
        actions={
          <button type="button" className="btn btn-default" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            Add destination
          </button>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          title="No destinations yet"
          description="Add the towns, regions or sights you guide in. Tours can then be grouped by destination, and guests can browse by place."
          action={
            <button type="button" className="btn btn-default" onClick={() => setEditing("new")}>
              Add your first destination
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden overflow-x-auto md:block">
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th className="pl-6">Destination</th>
                  <th>Region</th>
                  <th>Tours</th>
                  <th>Published</th>
                  <th className="pr-6 text-right">Order and actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((destination, index) => (
                  <tr key={destination.id}>
                    <td className="pl-6">
                      <span className="flex items-center gap-3">
                        <MediaThumb media={destination.coverUrl ? { url: destination.coverUrl } : null} alt="" className="h-11 w-16" sizes="64px" />
                        <span className="min-w-0">
                          <span className="block font-bold">{destination.name}</span>
                          <span className="block max-w-xs truncate text-xs text-muted-foreground">{destination.tagline || "No tagline"}</span>
                        </span>
                      </span>
                    </td>
                    <td>{destination.region || <span className="text-muted-foreground">Not set</span>}</td>
                    <td>{tourCountText(destination.tourCount)}</td>
                    <td>{publishedSwitch(destination)}</td>
                    <td className="whitespace-nowrap pr-6 text-right">{actionsFor(destination, index)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y md:hidden">
            {list.map((destination, index) => (
              <li key={destination.id} className="flex gap-3 p-4">
                <MediaThumb media={destination.coverUrl ? { url: destination.coverUrl } : null} alt="" className="h-16 w-20" sizes="80px" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{destination.name}</p>
                  <p className="text-xs text-muted-foreground">{[destination.region, tourCountText(destination.tourCount)].filter(Boolean).join(" · ")}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs font-semibold">
                    <span className="flex items-center gap-2">{publishedSwitch(destination)}Live</span>
                    {actionsFor(destination, index)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Panel
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        title={editing === "new" ? "Add destination" : "Edit destination"}
        description={editing && editing !== "new" ? editing.name : "A place your tours go."}
      >
        {editing ? (
          <DestinationForm
            key={editing === "new" ? "new" : editing.id}
            destination={editing === "new" ? null : editing}
            canPickMedia={canPickMedia}
            canUploadMedia={canUploadMedia}
            onDone={() => {
              setOrder(null);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Panel>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => (open ? undefined : setToDelete(null))}
        title={`Delete “${toDelete?.name ?? ""}”?`}
        description={
          <>
            <p>This removes it from your website immediately. This can’t be undone.</p>
            {remove.error ? (
              <p role="alert" className="alert alert-destructive mt-3">
                {remove.error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete"
        cancelLabel="Keep it"
        destructive
        pending={remove.pending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

const coordinate = (limit: number, name: string) =>
  z.string().refine((value) => {
    const parsed = parseCoordinate(value);
    return parsed === null || (!Number.isNaN(parsed) && Math.abs(parsed) <= limit);
  }, `${name} is a number between -${limit} and ${limit}.`);

// Immediate feedback only; the server validates again with its own schema.
const destinationSchema = z
  .object({
    name: z.string().trim().min(2, "Add a destination name (2+ characters).").max(120, "Keep the name under 120 characters."),
    slug: z
      .string()
      .max(80, "Keep the web address under 80 characters.")
      .refine((value) => value.trim() === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim()), "Use lowercase letters, numbers and single hyphens only."),
    region: z.string().max(120, "Keep the region under 120 characters."),
    tagline: z.string().max(200, "Keep the tagline under 200 characters."),
    description: z.string().max(5000, "Keep the description under 5,000 characters."),
    latitude: coordinate(90, "Latitude"),
    longitude: coordinate(180, "Longitude"),
    isPublished: z.boolean(),
  })
  .superRefine((values, context) => {
    if ((values.latitude.trim() === "") !== (values.longitude.trim() === "")) {
      context.addIssue({ code: "custom", path: [values.latitude.trim() === "" ? "latitude" : "longitude"], message: "Give both a latitude and a longitude, or neither." });
    }
  });
type DestinationValues = z.infer<typeof destinationSchema>;

interface DestinationFormProps {
  destination: DestinationItem | null;
  canPickMedia: boolean;
  canUploadMedia: boolean;
  onDone: () => void;
  onCancel: () => void;
}

function DestinationForm({ destination, canPickMedia, canUploadMedia, onDone, onCancel }: DestinationFormProps) {
  const form = useForm<DestinationValues>({
    resolver: zodResolver(destinationSchema),
    defaultValues: {
      name: destination?.name ?? "",
      slug: destination?.slug ?? "",
      region: destination?.region ?? "",
      tagline: destination?.tagline ?? "",
      description: destination?.description ?? "",
      latitude: destination?.latitude === null || destination?.latitude === undefined ? "" : String(destination.latitude),
      longitude: destination?.longitude === null || destination?.longitude === undefined ? "" : String(destination.longitude),
      isPublished: destination?.isPublished ?? true,
    },
  });
  const { errors } = form.formState;
  const name = useWatch({ control: form.control, name: "name" });
  const isPublished = useWatch({ control: form.control, name: "isPublished" });
  const [cover, setCover] = useState<{ id: string; url: string } | null>(destination?.coverMediaId && destination.coverUrl ? { id: destination.coverMediaId, url: destination.coverUrl } : null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const create = useAction(createDestinationAction, { success: "Destination added", toastError: false, onSuccess: onDone });
  const update = useAction(updateDestinationAction, { success: "Destination saved", toastError: false, onSuccess: onDone });
  const action = destination ? update : create;

  const onSubmit = form.handleSubmit((values) => {
    const slug = values.slug.trim();
    const payload = {
      name: values.name,
      // Left empty on a new destination, the server derives a free address from the name.
      ...(slug ? { slug } : {}),
      region: values.region.trim(),
      tagline: values.tagline.trim(),
      description: values.description.trim(),
      coverMediaId: cover?.id ?? null,
      latitude: parseCoordinate(values.latitude),
      longitude: parseCoordinate(values.longitude),
      isPublished: values.isPublished,
    };
    void (destination ? update.run({ id: destination.id, destination: payload }) : create.run({ destination: payload }));
  });

  const message = (field: keyof DestinationValues | "coverMediaId") => (field === "coverMediaId" ? null : errors[field]?.message) ?? firstError(action.fieldErrors, field);

  return (
    <>
      <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
          <FormError message={action.error && !action.fieldErrors ? action.error : null} />
          <Field label="Name" error={message("name")}>
            {(field) => <input {...field} {...form.register("name")} className="input" autoComplete="off" />}
          </Field>
          <Field
            label="Web address"
            note={destination ? undefined : "optional"}
            hint={destination ? "Lowercase letters, numbers and hyphens. Changing it breaks links that use the old one." : "Lowercase letters, numbers and hyphens. Left empty, it is made from the name."}
            error={message("slug")}
          >
            {(field) => (
              <input {...field} {...form.register("slug")} className="input font-mono" placeholder={destination ? undefined : slugFromTitle(name) || "made-from-the-name"} autoCapitalize="none" spellCheck={false} autoComplete="off" />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Region" note="optional" error={message("region")}>
              {(field) => <input {...field} {...form.register("region")} className="input" />}
            </Field>
            <Field label="Tagline" note="optional" error={message("tagline")}>
              {(field) => <input {...field} {...form.register("tagline")} className="input" />}
            </Field>
          </div>
          <Field label="Description" note="optional" error={message("description")}>
            {(field) => <textarea {...field} {...form.register("description")} className="textarea" rows={4} />}
          </Field>

          <div className="flex flex-col gap-2">
            <span className="label">Cover image</span>
            <div className="flex flex-wrap items-center gap-3">
              <MediaThumb media={cover} alt="" className="aspect-[4/3] w-32" sizes="128px" />
              {canPickMedia ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-outline" onClick={() => setPickerOpen(true)}>
                    <ImagePlus aria-hidden="true" />
                    {cover ? "Change image" : "Choose image"}
                  </button>
                  {cover ? (
                    <button type="button" className="btn btn-ghost" onClick={() => setCover(null)}>
                      Remove
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="field-hint">Your role cannot open the media library.</p>
              )}
            </div>
            {message("coverMediaId") ? (
              <span role="alert" className="field-error">
                {message("coverMediaId")}
              </span>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Latitude" note="optional" hint="With a longitude, the place can be shown on a map." error={message("latitude")}>
              {(field) => <input {...field} {...form.register("latitude")} className="input" inputMode="decimal" placeholder="e.g. 41.1919" />}
            </Field>
            <Field label="Longitude" note="optional" error={message("longitude")}>
              {(field) => <input {...field} {...form.register("longitude")} className="input" inputMode="decimal" placeholder="e.g. 47.1706" />}
            </Field>
          </div>

          <div className="rounded-lg border p-4">
            <ToggleRow label="Published" hint="Visible on your website" checked={isPublished} onChange={(checked) => form.setValue("isPublished", checked, { shouldDirty: true })} />
          </div>
        </div>

        <div className="safe-b sticky bottom-0 flex justify-end gap-2 border-t bg-background px-5 pt-3 sm:px-6">
          <button type="button" className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <SubmitButton pending={action.pending} pendingLabel="Saving…">
            {destination ? "Save destination" : "Add destination"}
          </SubmitButton>
        </div>
      </form>

      {canPickMedia ? (
        <MediaPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          resourceType="image"
          title="Cover image"
          canUpload={canUploadMedia}
          selectedIds={cover ? [cover.id] : []}
          onSelect={([asset]) => setCover(asset ? { id: asset.id, url: asset.url } : null)}
        />
      ) : null}
    </>
  );
}
