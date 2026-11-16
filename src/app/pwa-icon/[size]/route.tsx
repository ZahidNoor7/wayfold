import { ImageResponse } from "next/og";
import { renderAppIcon } from "@/components/pwa/app-icon";

const SIZES: Record<string, { size: number; maskable: boolean }> = {
  "180": { size: 180, maskable: false },
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  maskable: { size: 512, maskable: true },
};

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

/** Wayfold's own app icon, drawn rather than shipped as binaries. */
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const spec = SIZES[(await params).size];
  if (!spec) return new Response(null, { status: 404 });
  return new ImageResponse(
    renderAppIcon({ size: spec.size, maskable: spec.maskable, background: "#1d2353", foreground: "#d7ee4a", letter: "W" }),
    { width: spec.size, height: spec.size, headers: { "Cache-Control": "public, max-age=86400, immutable" } },
  );
}
