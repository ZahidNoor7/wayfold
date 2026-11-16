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
import type { ValuePropIcon as IconName } from "@/server/settings/site-content";

/**
 * The allow-list of value-proposition icons, one component per stored name.
 * Typed against the server's list, so adding a name there fails the build
 * here until it has an icon.
 */
const ICONS: Record<IconName, LucideIcon> = {
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

/** Decorative icon for a value proposition; the title beside it carries the meaning. */
export function ValuePropIcon({ name, className }: { name: IconName; className?: string }) {
  const Icon = ICONS[name] as LucideIcon | undefined;
  return Icon ? <Icon aria-hidden="true" className={className} /> : null;
}
