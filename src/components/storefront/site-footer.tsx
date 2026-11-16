import Link from "next/link";
import type { ReactNode } from "react";
import { experiencesHref, socialUrl, type SocialNetwork } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";
import { FacebookIcon, InstagramIcon, TikTokIcon, YouTubeIcon } from "./icons";
import { InlineWordmark } from "./wordmark";

export interface SiteFooterProps {
  name: string;
  /** Short description under the wordmark. Omitted when empty. */
  blurb: string;
  social: Partial<Record<SocialNetwork, string>>;
  showOffers: boolean;
  /** Published destinations; the column is left out when there are none. */
  destinations: { name: string; slug: string }[];
  email: string;
  phone: string;
  whatsapp: { number: string; url: string } | null;
  address: string;
  hours: string;
  /** Licence or registration line shown after the copyright. */
  licenceLine: string;
  year: string;
  /** Link for the "Powered by Wayfold" line; null when the plan removes it. */
  poweredByUrl: string | null;
  /** Shows the "Photo credits" link when published images carry credits. */
  hasPhotoCredits?: boolean;
}

const NETWORKS: { key: SocialNetwork; label: string; Icon: (props: { className?: string }) => ReactNode }[] = [
  { key: "instagram", label: "Instagram", Icon: InstagramIcon },
  { key: "youtube", label: "YouTube", Icon: YouTubeIcon },
  { key: "facebook", label: "Facebook", Icon: FacebookIcon },
  { key: "tiktok", label: "TikTok", Icon: TikTokIcon },
];

const MAX_DESTINATIONS = 6;

// Four columns in the design; a business without destinations or contact
// details gets a grid sized for what it has rather than an empty track.
const GRID: Record<number, string> = {
  2: "lg:grid-cols-[2fr_1fr]",
  3: "lg:grid-cols-[2fr_1fr_1.4fr]",
  4: "lg:grid-cols-[2fr_1fr_1fr_1.4fr]",
};

// Padding grows the hit area; the negative margin keeps the design's 12px rhythm.
const LINK = "-my-1.5 inline-block py-1.5 hover:text-hero-foreground";

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="eyebrow mb-4 !text-highlight">{title}</h2>
      <ul className="flex flex-col gap-3 text-[15px]">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link href={href} className={LINK}>
        {children}
      </Link>
    </li>
  );
}

/** Storefront footer. Every line comes from the business's own data; anything it has not filled in is simply absent. */
export function SiteFooter({
  name,
  blurb,
  social,
  showOffers,
  destinations,
  email,
  phone,
  whatsapp,
  address,
  hours,
  licenceLine,
  year,
  poweredByUrl,
  hasPhotoCredits = false,
}: SiteFooterProps) {
  const profiles = NETWORKS.flatMap((network) => {
    const href = socialUrl(network.key, social[network.key]);
    return href ? [{ ...network, href }] : [];
  });
  const places = destinations.slice(0, MAX_DESTINATIONS);
  // The same number is not listed twice when it is both the phone and the WhatsApp line.
  const digits = (value: string) => value.replace(/\D/g, "");
  const showPhone = phone !== "" && (!whatsapp || digits(phone) !== digits(whatsapp.number));
  const hasContact = Boolean(email || showPhone || whatsapp || address || hours);
  const columns = 2 + Number(places.length > 0) + Number(hasContact);

  return (
    <footer className="bg-hero pb-10 pt-20 text-hero-foreground/80">
      <div className="container-x">
        <div className={cn("grid gap-12 sm:grid-cols-2", GRID[columns])}>
          <div>
            <p className="font-display text-3xl text-hero-foreground">
              <InlineWordmark name={name} />
            </p>
            {blurb ? <p className="mt-4 max-w-sm text-[15px] leading-relaxed">{blurb}</p> : null}
            {profiles.length > 0 ? (
              <div className="mt-6 flex gap-2">
                {profiles.map(({ key, label, href, Icon }) => (
                  <a key={key} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${name} on ${label}`} className="btn btn-icon btn-hero-outline rounded-full">
                    <Icon />
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          <Column title="Explore">
            <FooterLink href="/experiences">Experiences</FooterLink>
            {showOffers ? <FooterLink href="/offers">Special offers</FooterLink> : null}
            <FooterLink href="/about">About</FooterLink>
            <FooterLink href="/journey">Journey</FooterLink>
            <FooterLink href="/reviews">Reviews</FooterLink>
            <FooterLink href="/contact">Contact</FooterLink>
          </Column>

          {places.length > 0 ? (
            <Column title="Destinations">
              {places.map((destination) => (
                <FooterLink key={destination.slug} href={experiencesHref({ destination: destination.slug })}>
                  {destination.name}
                </FooterLink>
              ))}
            </Column>
          ) : null}

          {hasContact ? (
            <Column title="Get in touch">
              {email ? (
                <li>
                  <a href={`mailto:${email}`} className={`${LINK} break-all`}>
                    {email}
                  </a>
                </li>
              ) : null}
              {showPhone ? (
                <li>
                  <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={LINK}>
                    {phone}
                  </a>
                </li>
              ) : null}
              {whatsapp ? (
                <li>
                  <a href={whatsapp.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                    {whatsapp.number} (WhatsApp)
                  </a>
                </li>
              ) : null}
              {address ? <li className="whitespace-pre-line">{address}</li> : null}
              {hours ? <li className="whitespace-pre-line">{hours}</li> : null}
            </Column>
          ) : null}
        </div>

        <div className="mt-16 flex flex-wrap justify-between gap-4 border-t border-hero-foreground/15 pt-7 text-[13px]">
          <span>
            © {year} {name}.{licenceLine ? ` ${licenceLine}` : ""}
          </span>
          <span className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/privacy" className="underline-offset-4 hover:underline">
              Privacy policy
            </Link>
            <Link href="/terms" className="underline-offset-4 hover:underline">
              Terms &amp; conditions
            </Link>
            {hasPhotoCredits ? (
              <Link href="/credits" className="underline-offset-4 hover:underline">
                Photo credits
              </Link>
            ) : null}
            {poweredByUrl ? (
              <a href={poweredByUrl} target="_blank" rel="noopener" className="text-hero-foreground/60 underline-offset-4 hover:text-hero-foreground hover:underline">
                Powered by Wayfold
              </a>
            ) : null}
          </span>
        </div>
      </div>
    </footer>
  );
}
