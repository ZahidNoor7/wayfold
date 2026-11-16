"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Header link on the hero-coloured bar; marks itself when it is the current page. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const current = !href.includes("#") && pathname === href;
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className="nav-link text-hero-foreground hover:bg-hero-foreground/10 hover:text-hero-foreground aria-[current=page]:text-highlight"
    >
      {children}
    </Link>
  );
}
