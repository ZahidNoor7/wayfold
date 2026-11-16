"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { addCustomerNoteAction, deleteCustomerNoteAction } from "@/app/workspace/customers/actions";
import { Field, firstError, FormError, SubmitButton } from "@/components/form";
import { ConfirmDialog } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";

const MAX_NOTE_LENGTH = 4000;

const noteSchema = z.object({
  body: z.string().trim().min(1, "Write a note first.").max(MAX_NOTE_LENGTH, `Keep the note under ${MAX_NOTE_LENGTH} characters.`),
});
type NoteValues = z.infer<typeof noteSchema>;

export interface CustomerNoteItem {
  id: string;
  body: string;
  /** Who wrote it; null when that team member's account no longer exists. */
  author: string | null;
  /** Already formatted in the workspace's timezone. */
  when: string;
}

interface CustomerNotesProps {
  customerId: string;
  notes: CustomerNoteItem[];
  /** Without customers.manage the notes can be read but not added to or deleted. */
  canManage: boolean;
}

/** Internal notes about a customer, newest first. Never shown to the customer. */
export function CustomerNotes({ customerId, notes, canManage }: CustomerNotesProps) {
  const form = useForm<NoteValues>({ resolver: zodResolver(noteSchema), defaultValues: { body: "" } });
  // The note stays set while the dialog closes, so its text does not vanish mid-animation.
  const [deleting, setDeleting] = useState<CustomerNoteItem | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const add = useAction(addCustomerNoteAction, { success: "Note saved", toastError: false, onSuccess: () => form.reset({ body: "" }) });
  const remove = useAction(deleteCustomerNoteAction, { success: "Note deleted", onSuccess: () => setConfirmOpen(false) });

  const onSubmit = form.handleSubmit((values) => add.run({ customerId, body: values.body }));
  const bodyError = form.formState.errors.body?.message ?? firstError(add.fieldErrors, "body");

  return (
    <div className="flex flex-col gap-5">
      {canManage ? (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <FormError message={add.error && !add.fieldErrors ? add.error : null} />
          <Field label="Add a note" note="· only your team sees this" error={bodyError}>
            {(control) => (
              <textarea
                {...control}
                {...form.register("body")}
                className="textarea"
                rows={3}
                maxLength={MAX_NOTE_LENGTH}
                placeholder="e.g. Vegetarian; prefers morning departures; travelling with her parents next spring"
              />
            )}
          </Field>
          <SubmitButton pending={add.pending} pendingLabel="Saving…" className="self-start">
            Save note
          </SubmitButton>
        </form>
      ) : null}

      {notes.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start gap-2 border-l-2 pl-3 text-[13px]">
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground">
                  {note.when}
                  {note.author ? ` · ${note.author}` : ""}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed">{note.body}</p>
              </div>
              {canManage ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm -mt-1 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete the note from ${note.when}`}
                  onClick={() => {
                    setDeleting(note);
                    setConfirmOpen(true);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {canManage ? "No notes yet. Anything worth remembering for next time belongs here." : "No notes have been added for this customer."}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!remove.pending) setConfirmOpen(open);
        }}
        title="Delete this note?"
        description={
          deleting ? (
            <>
              <p className="line-clamp-4 whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 text-foreground">{deleting.body}</p>
              <p className="mt-3">The note is removed for everyone on your team. This cannot be undone.</p>
            </>
          ) : null
        }
        confirmLabel="Delete note"
        cancelLabel="Keep note"
        destructive
        pending={remove.pending}
        onConfirm={() => {
          if (deleting) void remove.run({ customerId, noteId: deleting.id });
        }}
      />
    </div>
  );
}
