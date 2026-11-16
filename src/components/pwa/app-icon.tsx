import type { ReactElement } from "react";

interface AppIconOptions {
  size: number;
  /** Maskable icons keep the mark inside the central safe zone. */
  maskable: boolean;
  background: string;
  foreground: string;
  /** One or two characters. */
  letter: string;
}

/**
 * Icon artwork for `ImageResponse`: a monogram on a folded-map corner. Shared
 * by the Wayfold app icon and by tenant storefront icons (tenant colours).
 */
export function renderAppIcon({ size, maskable, background, foreground, letter }: AppIconOptions): ReactElement {
  const inset = maskable ? size * 0.14 : 0;
  const inner = size - inset * 2;
  const fold = inner * 0.3;
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background }}>
      <div
        style={{
          width: inner,
          height: inner,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          borderRadius: maskable ? 0 : size * 0.22,
          background,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 0,
            height: 0,
            borderTop: `${fold}px solid ${foreground}`,
            borderLeft: `${fold}px solid transparent`,
            opacity: 0.95,
          }}
        />
        <div style={{ display: "flex", fontSize: inner * 0.56, fontWeight: 700, color: foreground, letterSpacing: -inner * 0.02, fontFamily: "Georgia, serif" }}>
          {letter.slice(0, 2)}
        </div>
      </div>
    </div>
  );
}
