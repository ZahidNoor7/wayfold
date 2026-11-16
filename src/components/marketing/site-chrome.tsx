import Link from "next/link";
import { SUPPORT_EMAIL, supportMailto } from "@/components/auth/support";
import { Wordmark } from "@/components/auth/wordmark";
import { NavLink } from "./nav-link";
import { appUrl } from "./urls";

/**
 * Header of the marketing site. Sign-in and registration live on the app
 * host, so those two are ordinary absolute links, not router navigations.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 bg-hero/95 text-hero-foreground backdrop-blur-md">
      <div className="container-x flex h-20 items-center justify-between gap-3">
        <Link href="/" aria-label="Wayfold home" className="rounded-md">
          <Wordmark tone="hero" />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
          <NavLink href="/#themes">Themes</NavLink>
          <NavLink href="/#what-you-get">What you get</NavLink>
          <NavLink href="/#how-it-works">How it works</NavLink>
          <NavLink href="/pricing">Pricing</NavLink>
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <a href={appUrl("/login")} className="btn btn-ghost rounded-full px-3 text-hero-foreground hover:bg-hero-foreground/10 sm:px-4">
            Sign in
          </a>
          <a href={appUrl("/register")} className="btn btn-highlight rounded-full px-4 sm:px-5">
            Start free
          </a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-hero pb-10 pt-20 text-hero-foreground/80">
      <div className="container-x">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1.4fr]">
          <div>
            <Wordmark tone="hero" />
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed">
              A booking website under your own name, and one workspace for the tours, bookings, customers, reviews and discounts behind it.
            </p>
          </div>
          <div>
            <p className="eyebrow mb-4 !text-highlight">Product</p>
            <ul className="flex flex-col gap-3 text-[15px]">
              <li>
                <Link href="/#themes" className="hover:text-hero-foreground">
                  Themes
                </Link>
              </li>
              <li>
                <Link href="/#what-you-get" className="hover:text-hero-foreground">
                  What you get
                </Link>
              </li>
              <li>
                <Link href="/#how-it-works" className="hover:text-hero-foreground">
                  How it works
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-hero-foreground">
                  Pricing
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-4 !text-highlight">Account</p>
            <ul className="flex flex-col gap-3 text-[15px]">
              <li>
                <a href={appUrl("/login")} className="hover:text-hero-foreground">
                  Sign in
                </a>
              </li>
              <li>
                <a href={appUrl("/register")} className="hover:text-hero-foreground">
                  Create an account
                </a>
              </li>
              <li>
                <a href={appUrl("/forgot-password")} className="hover:text-hero-foreground">
                  Reset your password
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-4 !text-highlight">Get in touch</p>
            <ul className="flex flex-col gap-3 text-[15px]">
              <li>
                <a href={supportMailto()} className="break-all hover:text-hero-foreground">
                  {SUPPORT_EMAIL}
                </a>
              </li>
              <li>Questions about plans, moving an existing site, or anything else.</li>
            </ul>
          </div>
        </div>
        <div className="mt-16 border-t border-hero-foreground/15 pt-7 text-[13px]">
          <span>© Wayfold. Websites and back office for tour guides and small agencies.</span>
          <span className="ml-6 inline-flex gap-6">
            <Link href="/terms" className="underline-offset-4 hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="underline-offset-4 hover:underline">
              Privacy
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
