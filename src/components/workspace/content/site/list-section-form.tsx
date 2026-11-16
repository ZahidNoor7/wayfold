"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useRef } from "react";
import { useFieldArray, useForm, useWatch, type Path, type UseFormReturn } from "react-hook-form";
import { Field } from "@/components/form";
import { ValuePropIcon } from "@/components/storefront-content/value-prop-icon";
import { cn } from "@/lib/utils";
import type { ValuePropIcon as IconName } from "@/server/settings/site-content";
import { RowControls } from "../row-controls";
import { CountedField } from "./counted-field";
import { emptyRow, listSchema, listSectionErrorPath, rowLabel, rowsFromList, rowsToInput, type ListSpec, type ListValues, type RowFieldSpec } from "./site-model";
import { SectionCard, useSectionSave } from "./section-form";

interface ListSectionFormProps {
  spec: ListSpec;
  initial: readonly unknown[];
  origin: string;
  /** Allowed icons, for sections with an icon column. */
  icons?: readonly string[];
}

/** Grid for the short fields of a row; text areas and icon pickers take the full width below. */
function gridClass(fields: RowFieldSpec[]): string {
  const yearFirst = fields[0]?.kind === "year";
  if (fields.length === 1) return "";
  if (yearFirst) return fields.length >= 3 ? "sm:grid-cols-[7rem_1fr_1fr]" : "sm:grid-cols-[7rem_1fr]";
  return fields.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
}

/** One repeatable section (figures, languages, FAQ...): add, edit, reorder and remove rows. */
export function ListSectionForm({ spec, initial, origin, icons = [] }: ListSectionFormProps) {
  const form = useForm<ListValues>({ resolver: zodResolver(listSchema(spec)), defaultValues: { items: rowsFromList(spec, initial) } });
  const { fields, append, move, remove } = useFieldArray({ control: form.control, name: "items" });
  const rows = useWatch({ control: form.control, name: "items" }) ?? [];
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const { onSubmit, pending, formError } = useSectionSave({
    section: spec.section,
    form,
    toInput: (values) => rowsToInput(spec, values.items),
    fromSaved: (saved) => ({ items: rowsFromList(spec, Array.isArray(saved) ? saved : []) }),
    errorPath: (key) => listSectionErrorPath(spec, key),
    success: `${spec.title} saved`,
  });

  const full = fields.length >= spec.maxItems;
  const short = spec.fields.filter((field) => field.kind !== "textarea" && field.kind !== "icon");
  const wide = spec.fields.filter((field) => field.kind === "textarea" || field.kind === "icon");

  // Keep keyboard focus on the moved row's control; if it reached an end, use the other direction.
  function onMove(from: number, to: number) {
    move(from, to);
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${to}"]`);
      const wanted = to < from ? "up" : "down";
      const button =
        row?.querySelector<HTMLButtonElement>(`[data-row-action="${wanted}"]:not(:disabled)`) ??
        row?.querySelector<HTMLButtonElement>(`[data-row-action="${wanted === "up" ? "down" : "up"}"]:not(:disabled)`);
      button?.focus();
    });
  }

  function onRemove(index: number) {
    remove(index);
    requestAnimationFrame(() => {
      const next = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${Math.min(index, fields.length - 2)}"] [data-row-action="remove"]`);
      (next ?? addRef.current)?.focus();
    });
  }

  const rootError = (form.formState.errors.items?.root?.message ?? form.formState.errors.items?.message ?? form.formState.errors.root?.message) || null;

  return (
    <SectionCard
      id={`section-${spec.section}`}
      title={spec.title}
      description={spec.description}
      onSubmit={onSubmit}
      pending={pending}
      dirty={form.formState.isDirty}
      onDiscard={() => form.reset()}
      formError={formError}
      rootError={rootError}
      origin={origin}
      path={spec.path}
      saveLabel={`Save ${spec.title.toLowerCase()}`}
    >
      {fields.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing here yet. Add a {spec.noun} to show it on your website.
        </p>
      ) : (
        <ol ref={listRef} className="flex flex-col gap-3">
          {fields.map((field, index) => {
            const label = rowLabel(spec, rows[index] ?? {}, index);
            return (
              <li key={field.id} data-row-index={index} className="rounded-lg border bg-background p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[13px] font-semibold capitalize text-muted-foreground">
                    {spec.noun} {index + 1}
                  </p>
                  <RowControls index={index} count={fields.length} label={label} onMove={onMove} onRemove={onRemove} disabled={pending} />
                </div>
                <div className="flex flex-col gap-3">
                  {short.length > 0 ? (
                    <div className={cn("grid gap-3", gridClass(short))}>
                      {short.map((column) => (
                        <RowField key={column.key} form={form} index={index} field={column} />
                      ))}
                    </div>
                  ) : null}
                  {wide.map((column) =>
                    column.kind === "icon" ? (
                      <IconPicker key={column.key} form={form} index={index} field={column} icons={icons} />
                    ) : (
                      <RowField key={column.key} form={form} index={index} field={column} />
                    ),
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button ref={addRef} type="button" className="btn btn-outline btn-sm" disabled={full || pending} onClick={() => append(emptyRow(spec, icons))}>
          <Plus aria-hidden="true" />
          Add {spec.noun}
        </button>
        <span className="field-hint">
          {fields.length} of {spec.maxItems} {full ? `· that is the most you can add` : ""}
        </span>
      </div>
    </SectionCard>
  );
}

interface RowFieldProps {
  form: UseFormReturn<ListValues>;
  index: number;
  field: RowFieldSpec;
}

function RowField({ form, index, field }: RowFieldProps) {
  const name = `items.${index}.${field.key}` as Path<ListValues>;
  if (field.kind === "text" || field.kind === "textarea") {
    return (
      <CountedField
        form={form}
        name={name}
        label={field.label}
        max={field.max ?? 200}
        multiline={field.kind === "textarea"}
        rows={field.max && field.max > 500 ? 5 : 3}
        placeholder={field.placeholder}
        hint={field.hint}
        note={field.min ? undefined : "optional"}
      />
    );
  }
  const error = form.getFieldState(name, form.formState).error?.message as string | undefined;
  return (
    <Field label={field.label} hint={field.hint} error={error ?? null}>
      {(control) => (
        <input
          {...control}
          {...form.register(name)}
          className="input"
          inputMode="numeric"
          autoComplete="off"
          maxLength={field.kind === "year" ? 4 : 3}
          placeholder={field.kind === "year" ? "2014" : "90"}
        />
      )}
    </Field>
  );
}

interface IconPickerProps extends RowFieldProps {
  icons: readonly string[];
}

/** Radio group of icons; arrow keys move between them like any radio group. */
function IconPicker({ form, index, field, icons }: IconPickerProps) {
  const name = `items.${index}.${field.key}` as Path<ListValues>;
  const error = form.getFieldState(name, form.formState).error?.message as string | undefined;
  const errorId = `icon-error-${index}-${field.key}`;
  return (
    <fieldset aria-describedby={error ? errorId : undefined} className="flex flex-col gap-2">
      <legend className="label mb-2">{field.label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {icons.map((icon) => (
          <label
            key={icon}
            title={icon}
            className={cn(
              "flex size-11 cursor-pointer items-center justify-center rounded-lg border text-muted-foreground transition-colors duration-100",
              "hover:bg-muted has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground",
              "has-focus-visible:ring-[3px] has-focus-visible:ring-ring/60 active:scale-[0.97]",
            )}
          >
            <input type="radio" value={icon} {...form.register(name)} className="sr-only" />
            <ValuePropIcon name={icon as IconName} className="size-5" />
            <span className="sr-only">{icon}</span>
          </label>
        ))}
      </div>
      {error ? (
        <span id={errorId} role="alert" className="field-error">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}
