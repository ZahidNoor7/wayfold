import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/motion";
import { isCloudinaryUrl } from "@/lib/storefront-format";
import { cn } from "@/lib/utils";

export interface CtaBandProps {
  /** The business's response-time promise, e.g. "I reply personally within 24 hours." */
  responseTime: string;
  /** Background photograph; the band is plain hero colour without one. */
  image: { url: string } | null;
  hasTours: boolean;
}

/** Closing call to action. */
export function CtaBand({ responseTime, image, hasTours }: CtaBandProps) {
  const photo = image && isCloudinaryUrl(image.url) ? image : null;
  return (
    <section
      aria-labelledby="cta"
      // Without a photograph the band would run straight into the footer, which shares its colour.
      className={cn("relative overflow-hidden bg-hero py-28 lg:py-40", !photo && "border-b border-hero-foreground/15")}
    >
      {photo ? (
        <>
          <div className="parallax absolute inset-0">
            <Image src={photo.url} alt="" fill sizes="100vw" className="object-cover opacity-60" />
          </div>
          <div aria-hidden="true" className="absolute inset-0 bg-hero/50" />
        </>
      ) : null}
      <Reveal className="container-x relative max-w-4xl text-center text-hero-foreground">
        <h2 id="cta" className="font-display text-5xl font-medium leading-[1.02] sm:text-6xl lg:text-[76px]">
          Your next journey <em className="text-highlight">starts here.</em>
        </h2>
        <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-hero-foreground/85">
          {hasTours ? "Send a booking request in a couple of minutes." : "Tell us what you have in mind."}
          {responseTime ? ` ${responseTime}` : " Dates and details are confirmed with you before anything is final."}
        </p>
        <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
          {hasTours ? (
            <Link href="/book" className="btn btn-highlight btn-xl rounded-full">
              Book a tour
            </Link>
          ) : null}
          <Link href="/contact" className={cn("btn btn-xl rounded-full", hasTours ? "btn-hero-outline" : "btn-highlight")}>
            Get in touch
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
