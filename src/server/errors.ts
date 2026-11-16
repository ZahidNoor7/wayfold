/**
 * Errors whose message is safe to show to the person using the app. Anything
 * that is not an AppError is treated as internal: logged, and replaced with a
 * generic message before it reaches a client.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Please check the highlighted fields.", fieldErrors?: Record<string, string[]>) {
    super("validation", message, 422, fieldErrors);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super("unauthenticated", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super("forbidden", message, 403);
  }
}

/**
 * Also used when a record exists but belongs to another tenant: the caller
 * must not be able to tell the difference.
 */
export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super("not_found", `${what} not found.`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "conflict") {
    super(code, message, 409);
  }
}

export class LimitExceededError extends AppError {
  constructor(
    readonly limit: string,
    message: string,
  ) {
    super("plan_limit", message, 402);
  }
}

export class IntegrationError extends AppError {
  constructor(message: string, code = "integration_failed") {
    super(code, message, 502);
  }
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: string; error: string; fieldErrors?: Record<string, string[]> };

export const GENERIC_ERROR = "Something went wrong on our side. Please try again.";

/** Converts any thrown value into a client-safe result. Never leaks internals. */
export function toActionError(error: unknown, log: (error: unknown) => void = defaultLog): Extract<ActionResult, { ok: false }> {
  if (error instanceof AppError) {
    return { ok: false, code: error.code, error: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) };
  }
  log(error);
  return { ok: false, code: "internal", error: GENERIC_ERROR };
}

function defaultLog(error: unknown): void {
  // Message and stack only. Driver errors can carry bound parameters, which
  // may include personal data, so the raw object is never logged.
  const e = error as { name?: string; message?: string; code?: string };
  console.error("[wayfold] unhandled error", { name: e?.name, code: e?.code, message: String(e?.message ?? error).slice(0, 300) });
}
