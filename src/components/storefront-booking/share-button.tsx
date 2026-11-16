"use client";

import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Shares the current page: the device's share sheet where there is one,
 * otherwise the link is copied. The toast only claims what actually happened.
 */
export function ShareButton({ title, className = "btn-outline" }: { title: string; className?: string }) {
  async function share() {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // Closing the share sheet is a decision, not a failure.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("We could not copy the link. Copy it from the address bar instead.");
    }
  }

  return (
    <button type="button" className={cn("btn rounded-full", className)} onClick={() => void share()}>
      <Share2 aria-hidden="true" />
      Share
    </button>
  );
}
