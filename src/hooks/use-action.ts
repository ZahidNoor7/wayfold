"use client";

import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/errors";

/**
 * Next.js signals redirect() and notFound() from a Server Action by rejecting
 * the call with a control-flow error carrying a NEXT_* digest.
 */
export function isNavigation(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));
}

interface Options<T> {
  /** Toast shown on success. Name the thing that happened: "Tour published". */
  success?: string | ((data: T) => string);
  onSuccess?: (data: T) => void;
  /** Show failures as a toast too. Off for forms that render the error inline. */
  toastError?: boolean;
}

/**
 * Runs a Server Action that returns an ActionResult, tracking pending state
 * and surfacing errors. Field errors are exposed for inline display.
 */
export function useAction<I, T>(action: (input: I) => Promise<ActionResult<T>>, options: Options<T> = {}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>(undefined);
  const { success, onSuccess, toastError = true } = options;

  const run = useCallback(
    (input: I) =>
      new Promise<ActionResult<T>>((resolve) => {
        startTransition(async () => {
          setError(null);
          setFieldErrors(undefined);
          let result: ActionResult<T>;
          try {
            result = await action(input);
          } catch (thrown) {
            if (isNavigation(thrown)) {
              // The action called redirect() or notFound(): the router is
              // already navigating. Not an error; nothing to show.
              resolve({ ok: false, code: "navigating", error: "" });
              return;
            }
            // Network failure or a server crash before a result was produced.
            result = { ok: false, code: "network", error: "We could not reach the server. Check your connection and try again." };
          }
          if (result.ok) {
            if (success) toast.success(typeof success === "function" ? success(result.data) : success);
            onSuccess?.(result.data);
          } else {
            setError(result.error);
            setFieldErrors(result.fieldErrors);
            if (toastError && !result.fieldErrors) toast.error(result.error);
          }
          resolve(result);
        });
      }),
    [action, success, onSuccess, toastError],
  );

  const reset = useCallback(() => {
    setError(null);
    setFieldErrors(undefined);
  }, []);

  return { run, pending, error, fieldErrors, reset };
}
