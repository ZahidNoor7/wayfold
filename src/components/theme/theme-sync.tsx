"use client";

import { useLayoutEffect } from "react";

interface ThemeSyncProps {
  theme: string;
  radius: string;
  font: string;
  modeClass: "light" | "dark" | "mode-system";
}

const MODE_CLASSES = ["light", "dark", "mode-system"] as const;

/** Mirrors the active theme onto <html> for portals and the overscroll area. */
export function ThemeSync({ theme, radius, font, modeClass }: ThemeSyncProps) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = {
      theme: root.dataset.theme,
      radius: root.dataset.radius,
      font: root.dataset.font,
      mode: MODE_CLASSES.find((name) => root.classList.contains(name)),
    };
    root.dataset.theme = theme;
    root.dataset.radius = radius;
    root.dataset.font = font;
    root.classList.remove(...MODE_CLASSES);
    root.classList.add(modeClass);

    return () => {
      const restore = (key: "theme" | "radius" | "font", value: string | undefined) => {
        if (value === undefined) delete root.dataset[key];
        else root.dataset[key] = value;
      };
      restore("theme", previous.theme);
      restore("radius", previous.radius);
      restore("font", previous.font);
      root.classList.remove(...MODE_CLASSES);
      if (previous.mode) root.classList.add(previous.mode);
    };
  }, [theme, radius, font, modeClass]);

  return null;
}
