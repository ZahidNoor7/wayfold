import { Suspense } from "react";
import { ProfileForm } from "@/components/workspace/settings/profile-form";
import { AppearanceForm } from "@/components/workspace/settings/appearance-form";
import { BookingRulesForm } from "@/components/workspace/settings/booking-rules-form";
import { ContactForm } from "@/components/workspace/settings/contact-form";
import { SettingsLinks } from "@/components/workspace/settings/settings-links";
import { SettingsSections, type SettingsSection } from "@/components/workspace/settings/settings-sections";
import { currencyName } from "@/components/workspace/settings/tags";
import { selectableTimezones } from "@/components/workspace/settings/timezones";
import type { PreviewHero } from "@/components/workspace/settings/theme-preview";
import { PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { env } from "@/server/env";
import { getMedia } from "@/server/media";
import { getSiteContent } from "@/server/settings/site-content";
import { getBookingSettings } from "@/server/settings/tenant-settings";
import { getWorkspaceProfile, SUPPORTED_CURRENCIES } from "@/server/settings/workspace";
import { tenantOrigin } from "@/server/tenancy/hosts";

export const metadata = { title: "Settings & appearance" };

type SearchParams = Record<string, string | string[] | undefined>;

export default function SettingsPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={6} />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const workspace = await requireWorkspace("workspace.manage");
  const { tab } = await searchParams;
  const canBrand = can(workspace, "branding.manage");

  const { profile, booking, hero } = await inWorkspace(workspace, async (scope) => {
    const profile = await getWorkspaceProfile(scope);
    const booking = await getBookingSettings(scope);
    const hero = canBrand ? await previewHero(scope) : null;
    return { profile, booking, hero };
  });

  const protocol = env().APP_URL.startsWith("https://") ? "https" : "http";
  const storefrontUrl = tenantOrigin(profile.slug, { rootDomain: env().ROOT_DOMAIN, appHost: env().APP_HOST }, protocol);
  const currencies = [...SUPPORTED_CURRENCIES].sort((a, b) => currencyName(a).localeCompare(currencyName(b)));
  const timezones = selectableTimezones(Intl.supportedValuesOf("timeZone"));
  if (!timezones.includes(profile.timezone)) timezones.unshift(profile.timezone);

  const sections: SettingsSection[] = [];
  if (canBrand) {
    sections.push({
      id: "appearance",
      label: "Appearance",
      content: (
        <AppearanceForm
          initial={{
            theme: profile.branding.theme,
            mode: profile.branding.mode,
            radius: profile.branding.radius,
            font: profile.branding.font,
            logo: profile.branding.logoMediaId && profile.logoUrl ? { id: profile.branding.logoMediaId, url: profile.logoUrl } : null,
          }}
          brand={{ name: profile.name, tagline: profile.tagline }}
          hero={hero}
          storefrontUrl={storefrontUrl}
          media={{ canBrowse: can(workspace, "media.view"), canUpload: can(workspace, "media.manage") }}
        />
      ),
    });
  }
  sections.push(
    {
      id: "profile",
      label: "Profile",
      content: (
        <ProfileForm
          initial={{
            name: profile.name,
            tagline: profile.tagline,
            description: profile.description,
            languages: profile.languages,
            regions: profile.regions,
            currency: profile.currency,
            timezone: profile.timezone,
          }}
          currencies={currencies}
          timezones={timezones}
        />
      ),
    },
    {
      id: "contact",
      label: "Contact & social",
      content: (
        <ContactForm
          initial={{
            email: profile.email,
            phone: profile.phone,
            address: profile.address,
            website: profile.website,
            social: {
              instagram: profile.social.instagram ?? "",
              youtube: profile.social.youtube ?? "",
              facebook: profile.social.facebook ?? "",
              tiktok: profile.social.tiktok ?? "",
              whatsapp: profile.social.whatsapp ?? "",
            },
          }}
        />
      ),
    },
    {
      id: "booking",
      label: "Booking rules",
      content: <BookingRulesForm initial={booking} />,
    },
  );

  return (
    <>
      <PageHeader
        title="Settings & appearance"
        description="Manage your business profile, contact details, booking rules and how your site looks."
        actions={<SettingsLinks permissions={workspace.permissions} />}
      />
      <SettingsSections sections={sections} initial={typeof tab === "string" ? tab : (sections[0]?.id ?? "profile")} />
    </>
  );
}

/** The homepage hero as the storefront shows it, for the appearance preview. */
async function previewHero(scope: Parameters<typeof getSiteContent>[0]): Promise<PreviewHero> {
  const { hero } = await getSiteContent(scope);
  let imageUrl: string | null = null;
  if (hero.imageMediaId) {
    try {
      imageUrl = (await getMedia(scope, hero.imageMediaId)).url;
    } catch {
      // The image was removed from the library; the preview simply has no photo.
      imageUrl = null;
    }
  }
  return { kicker: hero.kicker, headline: hero.headline, emphasis: hero.headlineEmphasis, imageUrl };
}
