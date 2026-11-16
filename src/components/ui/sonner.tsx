"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toasts in the design's style: a dark pill near the bottom edge that names
 * what just happened. Colours come from the active theme's tokens.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      duration={3200}
      gap={8}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-max max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg",
          title: "leading-snug",
          description: "text-background/75",
          success: "[&_[data-icon]]:text-emerald-400",
          error: "[&_[data-icon]]:text-rose-400",
          icon: "shrink-0",
        },
      }}
      {...props}
    />
  );
}
