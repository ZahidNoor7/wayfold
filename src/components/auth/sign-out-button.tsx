"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Spinner } from "@/components/overlays";
import { clearCachesBriefly } from "./clear-caches";

interface SignOutButtonProps {
  /** Full button classes; replaces the default `btn btn-outline`. */
  className?: string;
  /** Same-origin path to return to after signing back in. */
  next?: string;
  children?: ReactNode;
}

/**
 * Signs out with a plain form post to `/logout` (it works before the page is
 * interactive too) and drops the service-worker caches on the way out.
 */
export function SignOutButton({ className = "btn btn-outline", next, children = "Sign out" }: SignOutButtonProps) {
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    setPending(true);
    await clearCachesBriefly();
    form.submit();
  }

  return (
    <form action="/logout" method="post" onSubmit={onSubmit} className="contents">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <button type="submit" className={className} disabled={pending} aria-busy={pending || undefined}>
        {pending ? <Spinner /> : null}
        {children}
      </button>
    </form>
  );
}
