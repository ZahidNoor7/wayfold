import type { Metadata } from "next";
import { MapPin, MessageCircle } from "lucide-react";
import { Suspense } from "react";
import { ContactForm } from "@/components/storefront-content/contact-form";
import { mapsHref, socialLinks, telHref } from "@/components/storefront-content/contact-helpers";
import { loadSite, seoMetadata } from "@/components/storefront-content/data";
import { ContentSkeleton, Paragraphs } from "@/components/storefront-content/prose";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { listPublishedTours } from "@/server/catalog/storefront";
import { inSite, siteToday } from "@/server/storefront/context";
import { sendInquiryAction } from "./actions";

interface Props {
  params: Promise<{ site: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { site } = await params;
  return seoMetadata(site, "contact", "/contact", ({ tenant }) => ({
    title: "Contact",
    description: `Send ${tenant.name} a message about a tour, a date or a tailor-made trip.`,
  }));
}

export default function ContactPage(props: Props) {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

const MICRO_LABEL = "mb-1 text-xs uppercase tracking-widest text-muted-foreground";
const DETAIL_LINK = "break-words font-semibold text-primary underline-offset-4 hover:underline";

async function Content({ params }: Props) {
  const { site } = await params;
  const { tenant, content, shell } = await loadSite(site);
  const tours = await inSite(tenant, async (scope) => (await listPublishedTours(scope, { limit: 100 })).items);
  const today = siteToday(tenant);

  const { contact, faq, hero } = content;
  // The same WhatsApp target as the header: the connected number, or the profile's.
  const whatsappNumber = shell.whatsapp?.number ?? "";
  const whatsappHref = shell.whatsapp?.url ?? null;
  const phoneHref = telHref(tenant.phone);
  const socials = socialLinks(tenant.social);
  const mapLink = mapsHref(contact.mapLatitude, contact.mapLongitude);
  const locations = contact.serviceLocations.length > 0 ? contact.serviceLocations : tenant.regions;
  const nowGuiding = hero.nowGuiding.trim();
  const hasDetails = Boolean(tenant.email || tenant.phone || tenant.address || locations.length > 0 || contact.hours || nowGuiding || socials.length > 0);
  const hasAside = Boolean(whatsappHref || hasDetails || mapLink);

  return (
    <>
      <section className={cn("pt-16 lg:pt-24", faq.length > 0 ? "pb-20" : "pb-28")}>
        <div className="container-x">
          <p className="eyebrow mb-4">Contact</p>
          <h1 className="mb-12 max-w-3xl wrap-break-word font-display text-5xl font-medium leading-none text-primary sm:text-6xl lg:text-[76px]">
            Get in touch with {tenant.name}
          </h1>

          <div className={cn("grid gap-10 lg:gap-14", hasAside ? "lg:grid-cols-[5fr_7fr]" : "max-w-3xl")}>
            {hasAside ? (
              <div className="flex flex-col gap-5">
                {whatsappHref ? (
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-4 rounded-xl bg-primary p-6 text-primary-foreground transition-opacity hover:opacity-95 active:opacity-90"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-highlight text-highlight-foreground">
                      <MessageCircle aria-hidden="true" className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[17px] font-bold">Chat on WhatsApp</span>
                      <span className="block text-sm opacity-85">{whatsappNumber}</span>
                    </span>
                  </a>
                ) : null}

                {hasDetails ? (
                  <div className="card flex flex-col gap-5 p-6 text-[15px]">
                    <dl className="flex flex-col gap-5 empty:hidden">
                      {tenant.email ? (
                        <div>
                          <dt className={MICRO_LABEL}>Email</dt>
                          <dd>
                            <a href={`mailto:${tenant.email}`} className={DETAIL_LINK}>
                              {tenant.email}
                            </a>
                          </dd>
                        </div>
                      ) : null}
                      {tenant.phone ? (
                        <div>
                          <dt className={MICRO_LABEL}>Phone</dt>
                          <dd>
                            {phoneHref ? (
                              <a href={phoneHref} className={DETAIL_LINK}>
                                {tenant.phone}
                              </a>
                            ) : (
                              <span className="font-semibold">{tenant.phone}</span>
                            )}
                          </dd>
                        </div>
                      ) : null}
                      {tenant.address ? (
                        <div>
                          <dt className={MICRO_LABEL}>Address</dt>
                          <dd>
                            <Paragraphs text={tenant.address} className="gap-1" paragraphClassName="font-semibold leading-relaxed" />
                          </dd>
                        </div>
                      ) : null}
                      {locations.length > 0 ? (
                        <div>
                          <dt className={MICRO_LABEL}>Service locations</dt>
                          <dd className="font-semibold leading-relaxed">{locations.join(", ")}</dd>
                        </div>
                      ) : null}
                      {contact.hours ? (
                        <div>
                          <dt className={MICRO_LABEL}>Working hours</dt>
                          <dd>
                            <Paragraphs text={contact.hours} className="gap-1" paragraphClassName="leading-relaxed" />
                          </dd>
                        </div>
                      ) : null}
                      {nowGuiding ? (
                        <div>
                          <dt className={MICRO_LABEL}>Now guiding</dt>
                          <dd className="flex items-center gap-2 text-sm font-semibold text-success">
                            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-success" />
                            {nowGuiding}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    {socials.length > 0 ? (
                      <ul className="flex flex-wrap gap-2" aria-label="Social profiles">
                        {socials.map((link) => (
                          <li key={link.network}>
                            <a href={link.href} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm rounded-full">
                              {link.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {mapLink ? (
                  <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted p-4 text-sm">
                    <span className="flex min-w-0 items-center gap-3">
                      <MapPin aria-hidden="true" className="size-6 shrink-0 text-primary" />
                      <span className="min-w-0">
                        <strong className="block">Find {tenant.name}</strong>
                        {tenant.address ? <span className="block truncate text-muted-foreground">{tenant.address.split("\n")[0]}</span> : null}
                      </span>
                    </span>
                    <a href={mapLink} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm shrink-0">
                      Open in Maps
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div>
              <ContactForm
                action={sendInquiryAction}
                businessName={tenant.name}
                tours={tours.map((tour) => ({ id: tour.id, title: tour.title }))}
                today={today}
                responseTime={contact.responseTime.trim()}
                whatsappHref={whatsappHref}
              />
            </div>
          </div>
        </div>
      </section>

      {faq.length > 0 ? (
        <section aria-labelledby="contact-faq" className="bg-secondary/60 py-20 lg:py-28">
          <div className="container-x max-w-3xl">
            <h2 id="contact-faq" className="mb-8 font-display text-4xl font-medium text-primary sm:text-5xl">
              Questions people ask
            </h2>
            <Accordion type="single" collapsible className="border-y">
              {faq.map((item, index) => (
                <AccordionItem key={index} value={`question-${index}`}>
                  <AccordionTrigger className="min-h-11 items-center gap-4 rounded-none py-4 text-base font-semibold">{item.question}</AccordionTrigger>
                  <AccordionContent className="pb-5 text-[15px] leading-relaxed text-foreground/85">
                    <Paragraphs text={item.answer} className="gap-3" />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>
      ) : null}
    </>
  );
}
