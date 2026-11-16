"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  FONT_OPTIONS,
  MODE_CLASS,
  MODE_OPTIONS,
  RADIUS_OPTIONS,
  THEME_OPTIONS,
  type FontId,
  type ModeId,
  type RadiusId,
  type ThemeId,
} from "./appearance-options";

/**
 * The design's appearance pickers. Each is a group of native radio buttons
 * (so arrow keys, focus and form semantics come for free) drawn as the
 * design's option cards; the selected card is found with `:has(:checked)`.
 */
interface GroupProps {
  legend: string;
  /** Hide the legend visually when a heading beside the group already names it. */
  hideLegend?: boolean;
  description?: string;
  className?: string;
  children: ReactNode;
}

function Group({ legend, hideLegend, description, className, children }: GroupProps) {
  return (
    <fieldset className="min-w-0">
      <legend className={hideLegend ? "sr-only" : "label mb-1"}>{legend}</legend>
      {description && !hideLegend ? <p className="mb-3 text-xs text-muted-foreground">{description}</p> : null}
      <div className={className}>{children}</div>
    </fieldset>
  );
}

const FOCUS = "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring";
const OPTION =
  "relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-border bg-card text-card-foreground transition-[border-color,background-color,transform] duration-150 hover:border-ring active:scale-[0.98] has-[:checked]:border-primary has-[:checked]:bg-accent";

interface PickerProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  hideLegend?: boolean;
  disabled?: boolean;
}

interface ThemePickerProps extends PickerProps<ThemeId> {
  /** The previews follow the colour scheme currently chosen. */
  mode: ModeId;
  /** Two words for the miniature hero; the second is drawn in the highlight colour. */
  brand: readonly [string, string];
  columns?: "two" | "four";
}

export function ThemePicker({ value, onChange, mode, brand, columns = "two", hideLegend, disabled }: ThemePickerProps) {
  const name = useId();
  return (
    <Group
      legend="Theme"
      hideLegend={hideLegend}
      description="Your brand colours across the public website and the dashboard."
      className={cn("grid gap-4", columns === "four" ? "grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2")}
    >
      {THEME_OPTIONS.map((theme) => {
        const selected = theme.id === value;
        return (
          <label
            key={theme.id}
            className={cn(
              "group relative flex cursor-pointer flex-col gap-3 rounded-xl border-2 border-border bg-card p-3 text-left text-card-foreground transition-[border-color,box-shadow,transform] duration-150 hover:border-ring active:scale-[0.99] has-[:checked]:border-primary has-[:checked]:shadow-md",
              FOCUS,
            )}
          >
            <input type="radio" name={name} value={theme.id} checked={selected} disabled={disabled} onChange={() => onChange(theme.id)} className="sr-only" />
            <span data-theme={theme.id} className={cn(MODE_CLASS[mode], "block overflow-hidden rounded-lg border bg-background")}>
              <span className="flex h-14 items-end bg-hero p-3">
                <span className="truncate font-display text-lg leading-none text-hero-foreground">
                  {brand[0]} <span className="text-highlight">{brand[1]}</span>
                </span>
              </span>
              <span className={cn("items-center gap-2 p-3", columns === "four" ? "hidden sm:flex" : "flex")}>
                <span className="h-7 flex-1 rounded-md bg-primary" />
                <span className="h-7 w-10 rounded-md bg-highlight" />
                <span className="h-7 w-10 rounded-md bg-secondary" />
                <span className="h-7 w-10 rounded-md border bg-card" />
              </span>
            </span>
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-bold">{theme.name}</span>
                <span className={cn("text-xs text-muted-foreground", columns === "four" ? "hidden sm:inline" : null)}>{theme.description}</span>
              </span>
              <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-primary">
                {selected ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
              </span>
            </span>
          </label>
        );
      })}
    </Group>
  );
}

const MODE_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

export function ModePicker({ value, onChange, hideLegend, disabled }: PickerProps<ModeId>) {
  const name = useId();
  return (
    <Group legend="Colour scheme" hideLegend={hideLegend} description="Light, dark, or follow each visitor’s device setting." className="grid grid-cols-3 gap-3">
      {MODE_OPTIONS.map((mode) => {
        const Icon = MODE_ICONS[mode.id];
        return (
          <label key={mode.id} className={cn(OPTION, FOCUS, "p-4 text-sm font-semibold")}>
            <input type="radio" name={name} value={mode.id} checked={mode.id === value} disabled={disabled} onChange={() => onChange(mode.id)} className="sr-only" />
            <Icon aria-hidden="true" className="size-5" />
            {mode.label}
          </label>
        );
      })}
    </Group>
  );
}

export function RadiusPicker({ value, onChange, hideLegend, disabled }: PickerProps<RadiusId>) {
  const name = useId();
  return (
    <Group legend="Corner style" hideLegend={hideLegend} description="Buttons, cards and inputs." className="grid grid-cols-4 gap-2">
      {RADIUS_OPTIONS.map((radius) => (
        <label key={radius.id} className={cn(OPTION, FOCUS, "p-3 text-xs font-semibold")}>
          <input type="radio" name={name} value={radius.id} checked={radius.id === value} disabled={disabled} onChange={() => onChange(radius.id)} className="sr-only" />
          <span
            aria-hidden="true"
            className="h-7 w-9 border-2 border-b-transparent border-l-primary border-r-transparent border-t-primary"
            style={{ borderTopLeftRadius: radius.px }}
          />
          {radius.label}
        </label>
      ))}
    </Group>
  );
}

export function FontPicker({ value, onChange, hideLegend, disabled }: PickerProps<FontId>) {
  const name = useId();
  return (
    <Group legend="Heading font" hideLegend={hideLegend} description="Body text stays Manrope." className="grid grid-cols-3 gap-2">
      {FONT_OPTIONS.map((font) => (
        <label key={font.id} className={cn(OPTION, FOCUS, "p-3 text-xs font-semibold")}>
          <input type="radio" name={name} value={font.id} checked={font.id === value} disabled={disabled} onChange={() => onChange(font.id)} className="sr-only" />
          <span aria-hidden="true" data-font={font.id} className="font-display text-3xl leading-none">
            Aa
          </span>
          {font.label}
        </label>
      ))}
    </Group>
  );
}
