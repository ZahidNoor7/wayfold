import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * House motion, done in CSS so that content is never hidden waiting for
 * JavaScript: server-rendered pages are fully visible, readable by search
 * engines, and still animate where the browser supports it. Reduced motion
 * is handled globally in globals.css.
 *
 * - Reveal / Stagger / StaggerItem: scroll-linked entrance (`.reveal`, a
 *   native view timeline). Browsers without view timelines show the content
 *   at once. Items further down a grid enter later on their own, so a
 *   stagger needs no timers.
 * - PageTransition: a short entrance on every navigation (used from
 *   `template.tsx`, which remounts per route).
 * - SwapIn: content that changes in place (tabs, wizard steps); key it by the
 *   step so it replays.
 */

interface BoxProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
}

interface RevealProps extends BoxProps {
  /** Kept for API compatibility; scroll position sets the timing. */
  delay?: number;
  /** Kept for API compatibility; the travel distance is part of the theme. */
  distance?: number;
}

export function Reveal({ children, className, style, id }: RevealProps) {
  return (
    <div id={id} className={cn("reveal", className)} style={style}>
      {children}
    </div>
  );
}

export function Stagger({ children, className, style, id }: BoxProps & { step?: number }) {
  return (
    <div id={id} className={className} style={style}>
      {children}
    </div>
  );
}

export function StaggerItem({ children, className, style, id }: BoxProps) {
  return (
    <div id={id} className={cn("reveal", className)} style={style}>
      {children}
    </div>
  );
}

export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("animate-page-in", className)}>{children}</div>;
}

export function SwapIn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("animate-swap-in", className)}>{children}</div>;
}
