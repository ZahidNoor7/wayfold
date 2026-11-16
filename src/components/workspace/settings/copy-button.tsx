"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/** Copies `value` and confirms in place for a moment. `label` names what is copied. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.error("Copying is blocked in this browser. Select the text and copy it instead.");
    }
  };

  return (
    <button type="button" onClick={copy} className="btn btn-outline btn-sm shrink-0" aria-label={copied ? `${label} copied` : `Copy ${label}`}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-hidden="true">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
