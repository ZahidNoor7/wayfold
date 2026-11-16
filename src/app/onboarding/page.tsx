import { redirect } from "next/navigation";
import { Suspense } from "react";
import { workspaceAddress } from "@/components/marketing/urls";
import { DEFAULT_APPEARANCE } from "@/components/onboarding/appearance-options";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { getWorkspaceProfile, SUPPORTED_CURRENCIES } from "@/server/settings/workspace";

export default function OnboardingPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="skeleton h-10 w-72 max-w-full" />
      <div className="skeleton h-2 w-full" />
      <div className="card flex flex-col gap-4 p-6 sm:p-9">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="skeleton h-11" />
        ))}
      </div>
    </div>
  );
}

/** Zones the profile service accepts: `Area/Location`, or UTC. */
function timezones(current: string): string[] {
  const supported = Intl.supportedValuesOf("timeZone").filter((zone) => /^[A-Z][A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(zone));
  const zones = ["UTC", ...supported.filter((zone) => zone !== "UTC")];
  return zones.includes(current) ? zones : [current, ...zones];
}

async function Content() {
  const workspace = await requireWorkspace("workspace.manage");
  // Setup belongs to the workspace's own people, and happens once.
  if (workspace.support || workspace.tenant.onboardingCompleted) redirect("/workspace");

  const profile = await inWorkspace(workspace, getWorkspaceProfile);
  const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });

  return (
    <OnboardingWizard
      workspaceName={profile.name}
      address={workspaceAddress(profile.slug)}
      profile={{
        tagline: profile.tagline,
        description: profile.description,
        email: profile.email,
        phone: profile.phone,
        address: profile.address,
        currency: profile.currency,
        timezone: profile.timezone,
        languages: profile.languages,
        regions: profile.regions,
      }}
      ownerEmail={workspace.user.email}
      appearance={{
        theme: profile.branding.theme ?? DEFAULT_APPEARANCE.theme,
        mode: profile.branding.mode ?? DEFAULT_APPEARANCE.mode,
        radius: profile.branding.radius ?? DEFAULT_APPEARANCE.radius,
        font: profile.branding.font ?? DEFAULT_APPEARANCE.font,
      }}
      currencies={SUPPORTED_CURRENCIES.map((code) => ({ code, name: currencyNames.of(code) ?? code }))}
      timezones={timezones(profile.timezone)}
      access={{
        branding: can(workspace, "branding.manage"),
        tours: can(workspace, "tours.manage"),
        integrations: can(workspace, "integrations.view"),
        team: can(workspace, "team.view"),
      }}
    />
  );
}
