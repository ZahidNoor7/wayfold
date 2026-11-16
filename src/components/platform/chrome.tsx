"use client";

import { Activity, Building2, CreditCard, Layers, LayoutDashboard, LifeBuoy, Menu, Plug, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Panel } from "@/components/overlays";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match the path exactly rather than by prefix. */
  exact?: boolean;
  ownerOnly?: boolean;
}

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Business",
    items: [
      { href: "/platform", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/platform/tenants", label: "Tenants", icon: Building2 },
      { href: "/platform/plans", label: "Plans", icon: Layers },
      { href: "/platform/billing", label: "Billing", icon: CreditCard },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/platform/support", label: "Support access", icon: LifeBuoy },
      { href: "/platform/integrations", label: "Integrations", icon: Plug, ownerOnly: true },
      { href: "/platform/system", label: "System", icon: Activity },
    ],
  },
];

export interface PlatformChromeProps {
  user: { name: string; email: string };
  role: "owner" | "support";
  children: ReactNode;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function Wordmark({ size = "lg" }: { size?: "sm" | "lg" }) {
  return (
    <Link href="/platform" className="flex min-w-0 items-baseline gap-2">
      <span className={`truncate font-display font-semibold text-primary ${size === "lg" ? "text-2xl" : "text-xl"}`}>Wayfold</span>
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.28em] text-eyebrow">Platform</span>
    </Link>
  );
}

function NavLinks({ role, pathname, onNavigate }: { role: PlatformChromeProps["role"]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Platform" className="flex flex-col gap-1 px-3">
      {NAV.map((group, index) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className={`px-3 pb-1 text-xs font-semibold text-muted-foreground ${index === 0 ? "pt-2" : "pt-4"}`}>{group.label}</p>
          {group.items
            .filter((item) => !item.ownerOnly || role === "owner")
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item) ? "page" : undefined}
                className="side-link h-11 lg:h-10"
                onClick={onNavigate}
              >
                <item.icon aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </Link>
            ))}
        </div>
      ))}
    </nav>
  );
}

function UserBlock({ user, role }: Pick<PlatformChromeProps, "user" | "role">) {
  return (
    <div className="flex items-center gap-3">
      <span className="avatar" aria-hidden="true">
        {initials(user.name)}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block truncate font-bold">{user.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{role === "owner" ? "Platform owner" : "Platform support, view only"}</span>
        <Link href="/workspaces" className="text-eyebrow underline-offset-4 hover:underline">
          Your workspaces
        </Link>
      </span>
    </div>
  );
}

function SignOut() {
  return (
    <form action="/logout" method="post">
      <button type="submit" className="btn btn-outline btn-sm w-full">
        Sign out
      </button>
    </form>
  );
}

/** The back office's own shell: Wayfold's sidebar, not a tenant's. */
export function PlatformChrome({ user, role, children }: PlatformChromeProps) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-dvh overflow-x-clip bg-muted/40 lg:flex">
      {/* Phone and tablet: top bar with a slide-out menu. */}
      <div className="glass sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-3 backdrop-blur lg:hidden">
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Open navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
          <Menu aria-hidden="true" />
        </button>
        <Wordmark size="sm" />
        <span className="avatar h-8 w-8 text-xs" aria-hidden="true">
          {initials(user.name)}
        </span>
      </div>

      <Panel open={navOpen} onOpenChange={setNavOpen} title="Platform navigation" side="left" hideHeader className="lg:hidden">
        <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <Wordmark />
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Close navigation" onClick={() => setNavOpen(false)}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="py-3">
          <NavLinks role={role} pathname={pathname} onNavigate={() => setNavOpen(false)} />
        </div>
        <div className="mt-auto flex flex-col gap-3 border-t p-4">
          <UserBlock user={user} role={role} />
          <SignOut />
        </div>
      </Panel>

      {/* Desktop: fixed sidebar. */}
      <aside className="hidden shrink-0 border-r bg-card lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:flex-col lg:overflow-y-auto">
        <div className="flex h-20 shrink-0 items-center px-5">
          <Wordmark />
        </div>
        <NavLinks role={role} pathname={pathname} />
        <div className="mt-auto flex flex-col gap-3 border-t p-4 pt-4">
          <UserBlock user={user} role={role} />
          <SignOut />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main id="main" className="min-w-0 flex-1 p-5 sm:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
