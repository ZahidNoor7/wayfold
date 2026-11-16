"use client";

import type { FormEventHandler, ReactNode } from "react";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { updateSiteSectionAction } from "@/app/workspace/site/actions";
import { FormError } from "@/components/form";
import { useAction } from "@/hooks/use-action";
import { serverErrorEntries, storefrontUrl } from "../helpers";
import { SaveBar } from "../save-bar";

interface SectionSaveOptions<V extends FieldValues> {
  section: string;
  form: UseFormReturn<V>;
  /** Form values → the section input the server expects. */
  toInput: (values: V) => unknown;
  /** Stored section (as returned) → form values, to reset the form after saving. */
  fromSaved: (saved: unknown) => V;
  /** Server error key → form path. */
  errorPath: (key: string) => string;
  /** Toast on success, e.g. "Home introduction saved". */
  success: string;
}

/**
 * Saving one section: sends it through `updateSiteSectionAction`, resets the
 * form to what was stored, and puts every server field error on its field.
 */
export function useSectionSave<V extends FieldValues>({ section, form, toInput, fromSaved, errorPath, success }: SectionSaveOptions<V>) {
  const { run, pending, error, fieldErrors } = useAction(updateSiteSectionAction, {
    success,
    toastError: false,
    onSuccess: (data) => form.reset(fromSaved(data.value)),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await run({ section, input: toInput(values) });
    if (result.ok) return;
    const entries = serverErrorEntries(result.fieldErrors, errorPath);
    entries.forEach(([path, message], index) => {
      form.setError(path as Path<V>, { type: "server", message }, { shouldFocus: index === 0 && path !== "root" });
    });
  });

  // A message with no field to sit beside (permission, network, unknown section).
  const formError = error && !fieldErrors ? error : null;
  return { onSubmit, pending, formError };
}

interface SectionCardProps {
  id: string;
  title: string;
  description: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;
  pending: boolean;
  dirty: boolean;
  onDiscard: () => void;
  formError?: string | null;
  /** Whole-form message from validation, e.g. "You can add up to 6." */
  rootError?: string | null;
  origin: string;
  /** Storefront path where this section shows. */
  path: string;
  viewLabel?: string;
  saveLabel?: string;
  /** Extra links in the header, e.g. a second page the section appears on. */
  extraLinks?: ReactNode;
  children: ReactNode;
}

/** One section of the site content: a card holding its own form and sticky save bar. */
export function SectionCard({
  id,
  title,
  description,
  onSubmit,
  pending,
  dirty,
  onDiscard,
  formError,
  rootError,
  origin,
  path,
  viewLabel,
  saveLabel = "Save changes",
  extraLinks,
  children,
}: SectionCardProps) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className="card scroll-mt-20">
      <form onSubmit={onSubmit} noValidate>
        <div className="card-header">
          <h2 id={headingId} className="card-title">
            {title}
          </h2>
          <p className="card-description">{description}</p>
          {extraLinks}
        </div>
        <div className="card-content flex flex-col gap-4">
          <FormError message={formError} />
          {rootError ? (
            <p role="alert" className="field-error">
              {rootError}
            </p>
          ) : null}
          {children}
        </div>
        <SaveBar
          pending={pending}
          dirty={dirty}
          label={saveLabel}
          viewHref={storefrontUrl(origin, path)}
          viewLabel={viewLabel}
          onDiscard={onDiscard}
          className="rounded-b-[inherit]"
        />
      </form>
    </section>
  );
}
