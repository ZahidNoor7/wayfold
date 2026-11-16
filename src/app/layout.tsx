import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Fraunces, Manrope } from "next/font/google";
import { ServiceWorker } from "@/components/pwa/service-worker";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Self-hosted at build time by next/font: no request to Google at runtime.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});
const fraunces = Fraunces({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-fraunces", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Wayfold", template: "%s · Wayfold" },
  description: "Run your tour business from one place: tours, bookings, customers and a website of your own.",
  applicationName: "Wayfold",
  // Resolved per host: the app serves its own, each storefront its tenant's.
  manifest: "/manifest.webmanifest",
  icons: { apple: "/pwa-icon/180" },
  appleWebApp: { capable: true, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${cormorant.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster />
        <ServiceWorker />
      </body>
    </html>
  );
}
