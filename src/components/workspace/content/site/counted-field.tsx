"use client";

import { useWatch, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { Field } from "@/components/form";
import { countLabel } from "../helpers";

interface CountedFieldProps<V extends FieldValues> {
  form: UseFormReturn<V>;
  name: Path<V>;
  label: string;
  max: number;
  multiline?: boolean;
  rows?: number;
  hint?: string;
  placeholder?: string;
  className?: string;
  /** Visible label hidden, e.g. inside a list row that has its own heading. */
  note?: string;
}

/** A text box or text area that shows how many of its characters are used. */
export function CountedField<V extends FieldValues>({ form, name, label, max, multiline, rows = 3, hint, placeholder, className, note }: CountedFieldProps<V>) {
  const value = useWatch({ control: form.control, name }) as string | undefined;
  const error = form.getFieldState(name, form.formState).error?.message;
  const counter = countLabel(value, max);

  return (
    <Field label={label} note={note ? `${note} · ${counter}` : `· ${counter}`} hint={hint} error={error ?? null} className={className}>
      {(control) =>
        multiline ? (
          <textarea {...control} {...form.register(name)} className="textarea" rows={rows} placeholder={placeholder} />
        ) : (
          <input {...control} {...form.register(name)} className="input" placeholder={placeholder} autoComplete="off" />
        )
      }
    </Field>
  );
}
