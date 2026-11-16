"use client";

import { Star } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";

interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
  legend?: string;
  error?: string | null;
  disabled?: boolean;
  name?: string;
}

const VALUES = [1, 2, 3, 4, 5] as const;

/**
 * A 1–5 rating as a group of native radio buttons drawn as stars. Arrow keys
 * move between them (native radio behaviour), each one is announced as
 * "N stars", and the focused star shows the global focus ring.
 */
export function StarRatingInput({ value, onChange, legend = "Rating", error, disabled, name }: StarRatingInputProps) {
  const id = useId();
  const groupName = name ?? `${id}-rating`;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={errorId} aria-invalid={error ? true : undefined} disabled={disabled}>
      <legend className="label mb-2">{legend}</legend>
      <div className="flex items-center gap-1">
        {VALUES.map((star) => {
          const filled = star <= value;
          return (
            <label
              key={star}
              className={cn(
                "relative flex size-11 cursor-pointer items-center justify-center rounded-md transition-transform duration-100 ease-out active:scale-95",
                "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/60",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={star}
                checked={value === star}
                onChange={() => onChange(star)}
                className="sr-only"
              />
              <Star aria-hidden="true" className={cn("size-7", filled ? "fill-highlight text-highlight" : "text-muted-foreground/50")} strokeWidth={1.5} />
              <span className="sr-only">{star === 1 ? "1 star" : `${star} stars`}</span>
            </label>
          );
        })}
        <span aria-hidden="true" className="ml-2 text-sm font-semibold text-muted-foreground">
          {value} / 5
        </span>
      </div>
      {error ? (
        <span id={errorId} role="alert" className="field-error">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}
