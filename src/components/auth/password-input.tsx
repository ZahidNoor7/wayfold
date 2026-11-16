"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Password field with a show/hide toggle. Pasting and password managers are
 * left alone; pass the right `autoComplete` ("current-password" or
 * "new-password") so they can do their job.
 */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;

  return (
    <div className="relative">
      <input type={shown ? "text" : "password"} className={cn("input pr-12", className)} autoCapitalize="none" spellCheck={false} {...props} />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        onClick={() => setShown((value) => !value)}
      >
        <Icon aria-hidden="true" className="size-[18px]" />
      </button>
    </div>
  );
}
