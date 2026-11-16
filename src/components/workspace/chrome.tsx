"use client";

import {
  Activity, CalendarDays, Compass, CreditCard, Images, LayoutDashboard, LayoutTemplate, MapPinned, Menu, MessageSquare, Moon,
  Notebook, Palette, Plug, Star, Sun, Tag, Users, UsersRound, X, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { clearCachesBriefly } from "@/components/auth/clear-caches";
import { Panel } from "@/components/overlays";
import { cn } from "@/lib/utils";
import type { NavCounts } from "@/server/workspace-nav";
import { isNavItemActive, type NavGroup, type NavIcon } from "./nav-config";

const ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  bookings: CalendarDays,
  customers: Users,
  inquiries: MessageSquare,
  tours: MapPinned,
  destinations: Compass,
  reviews: Star,
  journal: Notebook,
  media: Images,
  promotions: Tag,
  site: LayoutTemplate,
  settings: Palette,
  team: UsersRound,
  integrations: Plug,
  billing: CreditCard,
  activity: Activity,
};

export interface ChromeProps {
  workspaceName: string;
  storefrontUrl: string;
  user: { name: string; email: string };
  roleName: string;
  groups: NavGroup[];
  counts: NavCounts;
  /** Rendered above everything, e.g. the support-session banner. */
  banner?: ReactNode;
  children: ReactNode;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}


function Wordmark({ name, size = "lg" }: { name: string; size?: "sm" | "lg" }) {
  return (
    <Link href="/workspace" className="flex min-w-0 items-baseline gap-2">
      <span className={cn("truncate font-display font-semibold text-primary", size === "lg" ? "text-2xl" : "text-xl")}>{name}</span>
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.28em] text-eyebrow">Workspace</span>
    </Link>
  );
}

function NavLinks({ groups, counts, pathname, onNavigate }: { groups: NavGroup[]; counts: NavCounts; pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Workspace" className="flex flex-col gap-1 px-3">
      {groups.map((group, index) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className={cn("px-3 pb-1 text-xs font-semibold text-muted-foreground", index === 0 ? "pt-2" : "pt-4")}>{group.label}</p>
          {group.items.map((item) => {
            const Icon = ICONS[item.icon];
            const value = item.badge ? counts[item.badge] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isNavItemActive(pathname, item) ? "page" : undefined}
                className="side-link h-11 lg:h-10"
                onClick={onNavigate}
              >
                <Icon aria-hidden="true" />
                <span className="truncate">{item.label}</span>
                {value > 0 ? (
                  <span className={cn("badge ml-auto", item.badgeTone === "pending" ? "badge-pending" : "badge-highlight")}>
                    {value > 99 ? "99+" : value}
                    <span className="sr-only"> waiting</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * Holds the sign-out submit for a moment so this origin's service-worker
 * caches are dropped before the session ends, then submits as normal.
 */
function clearCachesOnSignOut(event: FormEvent<HTMLFormElement>) {
  const form = event.currentTarget;
  if (form.dataset.cleared === "1") return;
  event.preventDefault();
  void clearCachesBriefly().finally(() => {
    form.dataset.cleared = "1";
    form.requestSubmit();
  });
}

const MODE_KEY = "wf-workspace-mode";
const modeListeners = new Set<() => void>();

function readStoredMode(): "dark" | "light" | null {
  try {
    const stored = window.localStorage.getItem(MODE_KEY);
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    // Storage can be blocked; behave as if nothing was chosen.
    return null;
  }
}

function subscribeToMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}

/**
 * The dashboard's own light/dark preference. It is personal and lives in the
 * browser; the storefront's mode is a workspace setting and is not touched.
 * Until someone chooses, the workspace default rendered by the server stands.
 */
function useWorkspaceMode() {
  const stored = useSyncExternalStore(subscribeToMode, readStoredMode, () => null);

  useEffect(() => {
    if (!stored) return;
    for (const element of [document.querySelector<HTMLElement>("[data-workspace-root]")?.parentElement, document.documentElement]) {
      element?.classList.remove("light", "dark", "mode-system");
      element?.classList.add(stored);
    }
  }, [stored]);

  const dark = stored === "dark";

  function toggle() {
    try {
      window.localStorage.setItem(MODE_KEY, dark ? "light" : "dark");
    } catch {
      // Preference simply will not persist.
    }
    for (const listener of modeListeners) listener();
  }

  return { dark, toggle };
}

function UserBlock({ user, roleName, storefrontUrl }: Pick<ChromeProps, "user" | "roleName" | "storefrontUrl">) {
  return (
    <div className="flex items-center gap-3">
      <span className="avatar" aria-hidden="true">
        {initials(user.name)}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block truncate font-bold">{user.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{roleName}</span>
        <Link href="/workspace/account" className="mr-3 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Account
        </Link>
        <a href={storefrontUrl} target="_blank" rel="noreferrer" className="text-eyebrow underline-offset-4 hover:underline">
          View website<span className="sr-only"> (opens in a new tab)</span> ↗
        </a>
      </span>
    </div>
  );
}

export function WorkspaceChrome({ workspaceName, storefrontUrl, user, roleName, groups, counts, banner, children }: ChromeProps) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const { dark, toggle } = useWorkspaceMode();
  const ModeIcon = dark ? Sun : Moon;

  return (
    <div className="min-h-dvh overflow-x-clip bg-muted/40 lg:flex print:bg-background">
      {/* Phone and tablet: top bar with a slide-out menu. */}
      <div className="glass sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-3 backdrop-blur lg:hidden print:hidden">
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Open navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
          <Menu aria-hidden="true" />
        </button>
        <Wordmark name={workspaceName} size="sm" />
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-ghost btn-icon" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggle}>
            <ModeIcon aria-hidden="true" />
          </button>
          <span className="avatar h-8 w-8 text-xs" aria-hidden="true">
            {initials(user.name)}
          </span>
        </div>
      </div>

      <Panel open={navOpen} onOpenChange={setNavOpen} title="Workspace navigation" side="left" hideHeader className="lg:hidden">
        <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <Wordmark name={workspaceName} />
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Close navigation" onClick={() => setNavOpen(false)}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="py-3">
          <NavLinks groups={groups} counts={counts} pathname={pathname} onNavigate={() => setNavOpen(false)} />
        </div>
        <div className="mt-auto flex flex-col gap-3 border-t p-4">
          <UserBlock user={user} roleName={roleName} storefrontUrl={storefrontUrl} />
          <form action="/logout" method="post" onSubmit={clearCachesOnSignOut}>
            <button type="submit" className="btn btn-outline btn-sm w-full">
              Sign out
            </button>
          </form>
        </div>
      </Panel>

      {/* Desktop: fixed sidebar. */}
      <aside className="hidden shrink-0 border-r bg-card lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:flex-col lg:overflow-y-auto print:hidden">
        <div className="flex h-20 shrink-0 items-center px-5">
          <Wordmark name={workspaceName} />
        </div>
        <NavLinks groups={groups} counts={counts} pathname={pathname} />
        <div className="mt-auto flex flex-col gap-3 border-t p-4 pt-4">
          <UserBlock user={user} roleName={roleName} storefrontUrl={storefrontUrl} />
          <div className="flex items-center gap-2">
            <form action="/logout" method="post" className="flex-1" onSubmit={clearCachesOnSignOut}>
              <button type="submit" className="btn btn-outline btn-sm w-full">
                Sign out
              </button>
            </form>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggle}>
              <ModeIcon aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {banner ? <div className="print:hidden">{banner}</div> : null}
        <main id="main" className="min-w-0 flex-1 p-5 sm:p-8 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
