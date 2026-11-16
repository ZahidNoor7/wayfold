"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useSelectedLayoutSegments } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Panel } from "@/components/overlays";
import { pluralize } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";
import { isHeroRoute, pathFromSegments, sectionOf } from "./hero-routes";
import { MenuIcon, WhatsAppIcon } from "./icons";
import { InlineWordmark, Wordmark } from "./wordmark";

export interface SiteHeaderProps {
  /** The business name; the wordmark is drawn from it. */
  name: string;
  /** Live public offers. The Offers link is shown only when `showOffers` is true. */
  offerCount: number;
  showOffers: boolean;
  /** Click-to-chat link, or null when the business has no WhatsApp number. */
  whatsappUrl: string | null;
  email: string;
  phone: string;
}

/** Header turns solid once the page has moved this far. */
const SOLID_AFTER_PX = 40;

function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

/** True once the page is scrolled past the threshold. False on the server, where every page starts at the top. */
function useScrolled(): boolean {
  return useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > SOLID_AFTER_PX,
    () => false,
  );
}

const TRANSPARENT_LINK = "text-hero-foreground hover:bg-hero-foreground/10 hover:text-hero-foreground aria-[current=page]:text-highlight";
const MENU_LINK = "mnav animate-menu-item border-b border-hero-foreground/15 py-3 font-display text-4xl aria-[current=page]:text-highlight";

/**
 * Storefront header. Which state it starts in is decided from the route
 * segments below the storefront layout, which the server and the browser
 * agree on (unlike the URL, which the host rewrite changes), so a page with a
 * dark hero is server-rendered with the transparent header and nothing
 * flashes on load.
 */
export function SiteHeader({ name, offerCount, showOffers, whatsappUrl, email, phone }: SiteHeaderProps) {
  const path = pathFromSegments(useSelectedLayoutSegments());
  const section = sectionOf(path);
  const overHero = isHeroRoute(path);
  const scrolled = useScrolled();
  const [menuOpen, setMenuOpen] = useState(false);
  const solid = !overHero || scrolled || menuOpen;
  const closeMenu = () => setMenuOpen(false);

  const items = [
    { href: "/", label: "Home", menuLabel: "Home" },
    { href: "/about", label: "About", menuLabel: "About" },
    { href: "/experiences", label: "Experiences", menuLabel: "Experiences" },
    ...(showOffers ? [{ href: "/offers", label: "Offers", menuLabel: "Special offers", count: offerCount }] : []),
    { href: "/journey", label: "Journey", menuLabel: "Journey" },
    { href: "/reviews", label: "Reviews", menuLabel: "Reviews" },
    { href: "/contact", label: "Contact", menuLabel: "Contact" },
  ];
  const current = (href: string) => (href === section ? "page" : undefined);
  const iconButton = solid ? "btn-outline" : "btn-hero-outline";
  const contactLine = [email, phone].filter(Boolean).join(" · ");

  return (
    <>
      {/*
        On a dark-hero route the header's light text needs a dark surface from
        the first frame, before the page's own hero has faded in (and while a
        loading or error state stands in for it). This strip sits at the top
        of the page behind the content; the hero covers it.
      */}
      {overHero ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-20 bg-hero" /> : null}
      <header
        className={cn(
          "sticky top-0 z-40 border-b transition-colors duration-300",
          solid ? "bg-background/90 backdrop-blur-md" : "border-transparent bg-transparent",
          overHero && "-mb-20",
        )}
      >
        <div className="container-x flex h-20 items-center justify-between gap-4">
          <Link href="/" aria-label={`${name} home`} className="flex items-baseline gap-2">
            <Wordmark name={name} primaryClassName={solid ? "text-primary" : "text-hero-foreground"} restClassName={solid ? "text-eyebrow" : "text-highlight"} />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-0.5 xl:flex">
            {items.map((item) => (
              <Link key={item.href} href={item.href} aria-current={current(item.href)} className={cn("nav-link", !solid && TRANSPARENT_LINK)}>
                {item.label}
                {item.count ? (
                  <span className="ml-1.5 rounded-full bg-highlight px-1.5 text-[10px] font-bold text-highlight-foreground">
                    {item.count}
                    <span className="sr-only"> live {pluralize(item.count, "offer", "offers")}</span>
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {whatsappUrl ? (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Chat on WhatsApp"
                className={cn("btn btn-icon hidden rounded-full sm:inline-flex", iconButton)}
              >
                <WhatsAppIcon />
              </a>
            ) : null}
            <Link href="/book" className="btn btn-highlight rounded-full px-4 sm:px-5">
              <span className="sm:hidden">Book</span>
              <span className="hidden sm:inline">Book a tour</span>
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              className={cn("btn btn-icon rounded-full xl:hidden", iconButton)}
            >
              <MenuIcon />
            </button>
          </div>
        </div>
      </header>

      <Panel open={menuOpen} onOpenChange={setMenuOpen} title="Menu" hideHeader className="border-hero bg-hero p-6 text-hero-foreground sm:max-w-md">
        <div className="mb-10 flex items-center justify-between">
          <span className="font-display text-2xl font-semibold">
            <InlineWordmark name={name} />
          </span>
          <button type="button" onClick={closeMenu} aria-label="Close menu" className="btn btn-icon btn-hero-outline rounded-full">
            <X aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Mobile" className="flex flex-col">
          {items.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeMenu}
              aria-current={current(item.href)}
              className={MENU_LINK}
              style={{ animationDelay: `${((index + 1) * 0.04).toFixed(2)}s` }}
            >
              {item.menuLabel}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3 pt-8">
          <Link href="/book" onClick={closeMenu} className="btn btn-highlight btn-xl rounded-full">
            Book a tour
          </Link>
          {whatsappUrl ? (
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn btn-hero-outline btn-xl rounded-full">
              <WhatsAppIcon />
              Chat on WhatsApp
            </a>
          ) : null}
          {contactLine ? <p className="text-center text-sm text-hero-foreground/70">{contactLine}</p> : null}
        </div>
      </Panel>
    </>
  );
}
