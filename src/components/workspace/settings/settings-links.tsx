import { ChevronRight, Globe, LifeBuoy, PlugZap } from "lucide-react";
import Link from "next/link";

type Permissionless = readonly string[];

const LINKS = [
  { href: "/workspace/settings/domains", label: "Domains", icon: Globe, permission: "domains.manage" },
  { href: "/workspace/settings/integrations", label: "Integrations", icon: PlugZap, permission: "integrations.view" },
  { href: "/workspace/settings/support", label: "Support access", icon: LifeBuoy, permission: "support.manage" },
] as const;

/** The other settings pages, as header actions on the main settings page. */
export function SettingsLinks({ permissions }: { permissions: Permissionless }) {
  const visible = LINKS.filter((link) => permissions.includes(link.permission));
  if (visible.length === 0) return null;
  return (
    <nav aria-label="More settings" className="flex flex-wrap gap-2">
      {visible.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className="btn btn-outline btn-sm">
          <Icon aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** "Settings › Domains": the way back from a settings sub-page. */
export function SettingsBreadcrumb({ current, canOpenSettings }: { current: string; canOpenSettings: boolean }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumb mb-3">
      {canOpenSettings ? (
        <Link href="/workspace/settings" className="underline-offset-4 hover:text-foreground hover:underline">
          Settings
        </Link>
      ) : (
        <span>Settings</span>
      )}
      <ChevronRight aria-hidden="true" className="size-3.5" />
      <span aria-current="page" className="font-semibold text-foreground">
        {current}
      </span>
    </nav>
  );
}
