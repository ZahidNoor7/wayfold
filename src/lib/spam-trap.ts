/**
 * Spam check for public forms that carry a hidden "trap" field.
 *
 * People never see the trap, so it stays empty. Scripts fill every field and
 * submit at once. Browser autofill and password managers, however, sometimes
 * fill hidden fields for real visitors too, so a filled trap on its own is
 * not proof: the submission is only treated as automated when the trap is
 * filled *and* the form was sent faster than a person could type it (or the
 * sender did not say how long it took, which only a script skips).
 */

/** Quicker than any person can fill in a name, an e-mail and a message. */
export const MIN_HUMAN_FILL_MS = 3000;

export interface TrapSignals {
  /** Value of the hidden field. */
  trap?: string | null;
  /** Milliseconds between the form appearing and being sent, as the browser measured it. */
  elapsedMs?: number | null;
}

export function isAutomatedSubmission({ trap, elapsedMs }: TrapSignals): boolean {
  if (!trap || trap.trim() === "") return false;
  const measured = typeof elapsedMs === "number" && Number.isFinite(elapsedMs);
  return !measured || elapsedMs < MIN_HUMAN_FILL_MS;
}
