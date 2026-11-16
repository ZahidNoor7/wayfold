"use client";

import { ArrowDown, ArrowUp, Check, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { useState } from "react";
import { createCategoryAction, deleteCategoryAction, renameCategoryAction, reorderCategoriesAction } from "@/app/workspace/tours/actions";
import { ConfirmDialog, Modal, Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { moveItem } from "./tour-form-model";

export interface CategoryOption {
  id: string;
  name: string;
  tourCount: number;
}

/** The "Categories" button on the tours list and the dialog it opens. */
export function CategoryManager({ categories }: { categories: CategoryOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>
        <Tags aria-hidden="true" />
        Categories
      </button>
      <Modal open={open} onOpenChange={setOpen} title="Tour categories" description="Guests filter your tours by category. The order here is the order on your website.">
        {/* Mounted per opening, so the list starts from what is stored now. */}
        {open ? <CategoryList initial={categories} /> : null}
      </Modal>
    </>
  );
}

const NAME_MAX = 60;

function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Add a category name.";
  if (trimmed.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  return null;
}

function CategoryList({ initial }: { initial: CategoryOption[] }) {
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<{ id: string; name: string; error: string | null } | null>(null);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CategoryOption | null>(null);
  const [status, setStatus] = useState("");

  const create = useAction(createCategoryAction, { success: "Category added", toastError: false });
  const rename = useAction(renameCategoryAction, { success: "Category renamed", toastError: false });
  const reorder = useAction(reorderCategoriesAction);
  const remove = useAction(deleteCategoryAction, { success: "Category deleted", toastError: false });

  async function add() {
    const problem = nameProblem(draft);
    setDraftError(problem);
    if (problem) return;
    const result = await create.run({ name: draft.trim() });
    if (result.ok) {
      setList((current) => [...current, { id: result.data.id, name: result.data.name, tourCount: 0 }]);
      setDraft("");
    } else {
      setDraftError(result.fieldErrors?.name?.[0] ?? result.error);
    }
  }

  async function saveName() {
    if (!editing) return;
    const problem = nameProblem(editing.name);
    if (problem) {
      setEditing({ ...editing, error: problem });
      return;
    }
    const result = await rename.run({ id: editing.id, name: editing.name.trim() });
    if (result.ok) {
      setList((current) => current.map((category) => (category.id === result.data.id ? { ...category, name: result.data.name } : category)));
      setEditing(null);
    } else {
      setEditing({ ...editing, error: result.fieldErrors?.name?.[0] ?? result.error });
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const previous = list;
    const next = moveItem(list, index, target);
    setList(next);
    setStatus(`${list[index]!.name} moved to position ${target + 1} of ${list.length}.`);
    const result = await reorder.run({ orderedIds: next.map((category) => category.id) });
    if (!result.ok) {
      setList(previous);
      setStatus("The order could not be saved.");
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const result = await remove.run({ id: toDelete.id });
    if (result.ok) {
      setList((current) => current.filter((category) => category.id !== toDelete.id));
      setToDelete(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No categories yet. Add your first one below.</p>
      ) : (
        <ol className="flex flex-col divide-y rounded-lg border">
          {list.map((category, index) => (
            <li key={category.id} className="flex flex-col gap-2 px-3 py-2">
              {editing?.id === category.id ? (
                <form
                  noValidate
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveName();
                  }}
                >
                  <div className="flex items-center gap-2">
                    <input
                      className="input h-10 min-w-0 flex-1"
                      aria-label={`New name for ${category.name}`}
                      aria-invalid={Boolean(editing.error)}
                      value={editing.name}
                      maxLength={NAME_MAX + 20}
                      autoFocus
                      onChange={(event) => setEditing({ id: category.id, name: event.target.value, error: null })}
                    />
                    <button type="submit" className="btn btn-default btn-icon shrink-0" aria-label="Save name" disabled={rename.pending}>
                      {rename.pending ? <Spinner /> : <Check aria-hidden="true" />}
                    </button>
                    <button type="button" className="btn btn-ghost btn-icon shrink-0" aria-label="Cancel renaming" onClick={() => setEditing(null)}>
                      <X aria-hidden="true" />
                    </button>
                  </div>
                  {editing.error ? (
                    <span role="alert" className="field-error">
                      {editing.error}
                    </span>
                  ) : null}
                </form>
              ) : (
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{category.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {category.tourCount === 0 ? "No tours" : `${category.tourCount} ${category.tourCount === 1 ? "tour" : "tours"}`}
                    </p>
                  </div>
                  <button type="button" className="btn btn-ghost btn-icon shrink-0" aria-label={`Move ${category.name} up`} disabled={index === 0 || reorder.pending} onClick={() => void move(index, -1)}>
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon shrink-0"
                    aria-label={`Move ${category.name} down`}
                    disabled={index === list.length - 1 || reorder.pending}
                    onClick={() => void move(index, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon shrink-0" aria-label={`Rename ${category.name}`} onClick={() => setEditing({ id: category.id, name: category.name, error: null })}>
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon shrink-0 text-destructive hover:text-destructive"
                    aria-label={`Delete ${category.name}`}
                    onClick={() => {
                      remove.reset();
                      setToDelete(category);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <form
        noValidate
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label htmlFor="new-category" className="label">
          New category
        </label>
        <div className="flex gap-2">
          <input
            id="new-category"
            className="input min-w-0 flex-1"
            placeholder="e.g. Food & local life"
            value={draft}
            aria-invalid={Boolean(draftError)}
            aria-describedby={draftError ? "new-category-error" : undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftError(null);
            }}
          />
          <button type="submit" className="btn btn-default h-11 shrink-0" disabled={create.pending} aria-busy={create.pending || undefined}>
            {create.pending ? <Spinner /> : <Plus aria-hidden="true" />}
            Add
          </button>
        </div>
        {draftError ? (
          <span id="new-category-error" role="alert" className="field-error">
            {draftError}
          </span>
        ) : null}
      </form>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => (open ? undefined : setToDelete(null))}
        title={`Delete the category “${toDelete?.name ?? ""}”?`}
        description={
          <>
            <p>It disappears from the category filter on your website. This can’t be undone.</p>
            {remove.error ? (
              <p role="alert" className="alert alert-destructive mt-3">
                {remove.error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete category"
        cancelLabel="Keep it"
        destructive
        pending={remove.pending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
