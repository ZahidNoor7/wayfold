"use client";

import { Printer } from "lucide-react";

/** Opens the browser's print dialog; the invoice page hides everything else when printed. */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-default print:hidden" onClick={() => window.print()}>
      <Printer aria-hidden="true" />
      {label}
    </button>
  );
}
