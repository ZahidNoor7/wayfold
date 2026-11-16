import {
  Award,
  Calendar,
  Camera,
  Car,
  Clock,
  Compass,
  Globe,
  Handshake,
  Heart,
  Leaf,
  Map,
  Mountain,
  Shield,
  Sparkles,
  Star,
  Sun,
  Users,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { Reveal } from "@/components/motion";
import type { ValuePropIcon } from "@/server/settings/site-content";

/** Every icon name site content may store, mapped to its drawing. */
const ICONS: Record<ValuePropIcon, LucideIcon> = {
  award: Award,
  calendar: Calendar,
  camera: Camera,
  car: Car,
  clock: Clock,
  compass: Compass,
  globe: Globe,
  handshake: Handshake,
  heart: Heart,
  leaf: Leaf,
  map: Map,
  mountain: Mountain,
  shield: Shield,
  sparkles: Sparkles,
  star: Star,
  sun: Sun,
  users: Users,
  utensils: Utensils,
};

export interface ValuePropsProps {
  items: { title: string; text: string; icon: ValuePropIcon }[];
}

/** The business's reasons to travel with it, on the hero surface. */
export function ValueProps({ items }: ValuePropsProps) {
  return (
    <section aria-labelledby="why" className="bg-hero py-20 text-hero-foreground lg:py-32">
      <div className="container-x">
        <Reveal className="mb-14 max-w-2xl">
          <p className="eyebrow mb-4 !text-highlight">What to expect</p>
          <h2 id="why" className="font-display text-4xl font-medium leading-tight sm:text-5xl lg:text-[56px]">
            What sets these journeys apart
          </h2>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => {
            const Icon = ICONS[item.icon] ?? Compass;
            return (
              <Reveal key={`${item.title}:${index}`} className="border-t border-highlight/30 px-1 py-9 sm:pr-8">
                <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-highlight/50 text-highlight">
                  <Icon aria-hidden="true" className="size-[22px]" strokeWidth={1.5} />
                </span>
                <h3 className="mb-2 font-display text-[28px]">{item.title}</h3>
                {item.text ? <p className="whitespace-pre-line text-[15px] leading-relaxed text-hero-foreground/75">{item.text}</p> : null}
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
