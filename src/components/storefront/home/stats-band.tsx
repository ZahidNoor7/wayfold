"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { easeOutCubic, formatStat, parseStat } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";

export interface StatsBandProps {
  /** The business's own figures, as typed: "2,900+", "4.9 / 5". */
  stats: { label: string; value: string }[];
}

const DURATION_MS = 1600;

const COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 lg:grid-cols-5",
  6: "grid-cols-2 lg:grid-cols-6",
};

/**
 * Highlights band. The figures are server-rendered at their real values; once
 * the band scrolls into view they count up to them. With reduced motion, or
 * without script, they simply stay as they are. Screen readers always get
 * the real figure, never a frame of the animation.
 */
export function StatsBand({ stats }: StatsBandProps) {
  const reduce = useReducedMotion();
  const band = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    const node = band.current;
    if (reduce || !node || typeof IntersectionObserver === "undefined") return;

    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        const started = performance.now();
        const step = (now: number) => {
          const elapsed = Math.min(1, (now - started) / DURATION_MS);
          setProgress(easeOutCubic(elapsed));
          if (elapsed < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [reduce]);

  return (
    <section ref={band} aria-label="Highlights" className="bg-primary text-primary-foreground">
      <dl className={cn("container-x grid gap-6 py-8", COLUMNS[Math.min(stats.length, 6)])}>
        {stats.slice(0, 6).map((stat, index) => {
          const parsed = progress < 1 ? parseStat(stat.value) : null;
          return (
            <div key={index} className="flex flex-col-reverse">
              <dt className="text-[13px] opacity-80">{stat.label}</dt>
              <dd className="font-display text-4xl tabular-nums text-highlight">
                {parsed ? (
                  <>
                    <span aria-hidden="true">{formatStat(parsed, progress)}</span>
                    <span className="sr-only">{stat.value}</span>
                  </>
                ) : (
                  stat.value
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
