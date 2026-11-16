import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * shadcn's Button, mapped onto the Wayfold button classes (see
 * app/components.css) so components and hand-written markup look identical.
 */
const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "btn-default",
      highlight: "btn-highlight",
      outline: "btn-outline",
      "hero-outline": "btn-hero-outline",
      ghost: "btn-ghost",
      secondary: "btn-secondary",
      destructive: "btn-destructive",
      link: "btn-link",
    },
    size: {
      default: "",
      xs: "btn-sm",
      sm: "btn-sm",
      lg: "btn-lg",
      xl: "btn-xl",
      icon: "btn-icon",
      "icon-xs": "btn-icon btn-sm",
      "icon-sm": "btn-icon btn-sm",
      "icon-lg": "btn-icon-lg",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      // A button inside a form submits it unless told otherwise.
      {...(asChild ? {} : { type: type ?? "button" })}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
