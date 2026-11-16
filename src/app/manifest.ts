import type { MetadataRoute } from "next";

/**
 * Manifest for the Wayfold app host (dashboard). Each tenant storefront
 * serves its own manifest from /s/[site]/manifest.webmanifest, so an
 * installed storefront carries the tenant's name and colours, not Wayfold's.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/workspace",
    name: "Wayfold Workspace",
    short_name: "Wayfold",
    description: "Tours, bookings and customers for your tour business.",
    start_url: "/workspace",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f8f8fb",
    theme_color: "#1d2353",
    categories: ["business", "travel", "productivity"],
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Bookings", url: "/workspace/bookings" },
      { name: "Tours", url: "/workspace/tours" },
    ],
  };
}
