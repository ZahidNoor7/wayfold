"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Runs a task once typing has paused. Scheduling again, or cancelling, makes
 * any earlier task's answer irrelevant: the task is told so through
 * `isCurrent`, which it checks after each await before touching state.
 */
export function usePausedTask(pauseMs: number) {
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    latest.current += 1;
  }, []);

  const schedule = useCallback(
    (task: (isCurrent: () => boolean) => Promise<void>) => {
      window.clearTimeout(timer.current);
      const id = ++latest.current;
      timer.current = window.setTimeout(() => void task(() => latest.current === id), pauseMs);
    },
    [pauseMs],
  );

  return { schedule, cancel };
}
