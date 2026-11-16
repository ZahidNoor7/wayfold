import { splitWordmark } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";

interface WordmarkProps {
  name: string;
  /** Classes for the display word (colour changes with the header state). */
  primaryClassName?: string;
  /** Classes for the tracked sub-label. */
  restClassName?: string;
}

/**
 * The header wordmark: the first word of the business name in display type,
 * the remaining words as a small tracked label. A one-word name has no label.
 */
export function Wordmark({ name, primaryClassName, restClassName }: WordmarkProps) {
  const { primary, rest } = splitWordmark(name);
  return (
    <>
      <span className={cn("font-display text-[24px] font-semibold leading-none sm:text-[26px]", primaryClassName)}>{primary}</span>
      {rest ? <span className={cn("text-[10px] font-semibold uppercase tracking-[0.32em]", restClassName)}>{rest}</span> : null}
    </>
  );
}

/** The wordmark on hero surfaces (menu, footer): one line, remaining words in the highlight colour. */
export function InlineWordmark({ name }: { name: string }) {
  const { primary, rest } = splitWordmark(name);
  return (
    <>
      {primary}
      {rest ? <span className="text-highlight"> {rest}</span> : null}
    </>
  );
}
