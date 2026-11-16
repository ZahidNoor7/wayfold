import type { SVGProps } from "react";

/**
 * Glyphs lucide does not ship (it carries no brand marks). These are the
 * design's own line drawings; all are decorative and take their size from
 * the button they sit in.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "aria-hidden": true } as const;

export function WhatsAppIcon(props: IconProps) {
  return (
    <svg {...base} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 21l1.6-4.8A8.5 8.5 0 1 1 7.8 19.4L3 21z" />
      <path d="M9 9.5c.3 1.8 1.7 3.6 3.6 4.6l1.3-1.1 2 .9-.4 1.8c-3.6.2-7.4-3.4-7.3-7.1l1.8-.4.9 2z" />
    </svg>
  );
}

export function InstagramIcon(props: IconProps) {
  return (
    <svg {...base} strokeWidth={1.6} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

export function YouTubeIcon(props: IconProps) {
  return (
    <svg {...base} strokeWidth={1.6} {...props}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" />
    </svg>
  );
}

export function FacebookIcon(props: IconProps) {
  return (
    <svg {...base} strokeWidth={1.6} {...props}>
      <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z" />
    </svg>
  );
}

export function TikTokIcon(props: IconProps) {
  return (
    <svg {...base} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M14 4c.4 2.4 2 4 4.5 4.3" />
    </svg>
  );
}

/** The design's menu glyph: three lines, the last one shorter. */
export function MenuIcon(props: IconProps) {
  return (
    <svg {...base} strokeWidth={1.8} strokeLinecap="round" {...props}>
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  );
}
