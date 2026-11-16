"use client";

import { AlertDialog, Dialog } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Drawer } from "vaul";
import { cn } from "@/lib/utils";

interface PanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Always required: it names the dialog for assistive technology. */
  title: string;
  description?: string;
  side?: "right" | "left";
  /** Hide the built-in header when the panel draws its own. */
  hideHeader?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Side panel (the design's sheet-right / sheet-left). Focus is trapped while
 * open, Escape and the scrim close it, and focus returns to the trigger.
 */
export function Panel({ open, onOpenChange, title, description, side = "right", hideHeader, className, children }: PanelProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className={cn(side === "right" ? "sheet-right sm:max-w-xl" : "sheet-left", "overflow-y-auto outline-none", className)}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          {hideHeader ? (
            <>
              <Dialog.Title className="sr-only">{title}</Dialog.Title>
              {description ? <Dialog.Description className="sr-only">{description}</Dialog.Description> : null}
            </>
          ) : (
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-background/95 px-5 py-4 backdrop-blur sm:px-6">
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-bold leading-tight">{title}</Dialog.Title>
                {description ? <Dialog.Description className="mt-1 text-sm text-muted-foreground">{description}</Dialog.Description> : null}
              </div>
              <Dialog.Close className="btn btn-ghost btn-icon -mr-2 shrink-0 rounded-full" aria-label="Close">
                <X aria-hidden="true" />
              </Dialog.Close>
            </header>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
  /** Pinned below the scrolling body: primary actions within thumb reach. */
  footer?: ReactNode;
}

/**
 * Bottom sheet that tracks the finger 1:1, carries release velocity into its
 * settle, and can be flicked away. Used for mobile filters and booking.
 */
export function BottomSheet({ open, onOpenChange, title, description, className, children, footer }: BottomSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="overlay" />
        <Drawer.Content
          className={cn("sheet-bottom outline-none", className)}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div aria-hidden="true" className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
          <header className="flex items-start justify-between gap-4 px-5 pb-3 pt-3">
            <div className="min-w-0">
              <Drawer.Title className="text-lg font-bold leading-tight">{title}</Drawer.Title>
              {description ? <Drawer.Description className="mt-1 text-sm text-muted-foreground">{description}</Drawer.Description> : null}
            </div>
            <Drawer.Close className="btn btn-ghost btn-icon -mr-2 shrink-0 rounded-full" aria-label="Close">
              <X aria-hidden="true" />
            </Drawer.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer ? <footer className="safe-b border-t bg-background px-5 pt-3">{footer}</footer> : null}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}

/** Centred dialog for short, focused tasks. */
export function Modal({ open, onOpenChange, title, description, className, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay z-[60]" />
        <Dialog.Content className={cn("dialog outline-none", className)} {...(description ? {} : { "aria-describedby": undefined })}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold leading-tight">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1.5 text-sm text-muted-foreground">{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close className="btn btn-ghost btn-icon -mr-2 -mt-2 shrink-0 rounded-full" aria-label="Close">
              <X aria-hidden="true" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. Use for irreversible actions. */
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}

/**
 * Confirmation for consequential actions. It cannot be dismissed by clicking
 * outside, and the safe choice receives focus first.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive,
  pending,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay z-[60]" />
        <AlertDialog.Content className="dialog outline-none">
          <div>
            <AlertDialog.Title className="text-lg font-bold leading-tight">{title}</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</div>
            </AlertDialog.Description>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel className="btn btn-outline" disabled={pending}>
              {cancelLabel}
            </AlertDialog.Cancel>
            <button
              type="button"
              className={cn("btn", destructive ? "btn-destructive" : "btn-default")}
              disabled={pending}
              aria-busy={pending || undefined}
              onClick={onConfirm}
            >
              {pending ? <Spinner /> : null}
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn("animate-spin", className)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
