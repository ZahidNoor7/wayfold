import { StorefrontSkeleton } from "@/components/storefront/skeletons";

/** Fallback for storefront pages without their own: dark-hero pages get the hero stand-in, the rest a plain one. */
export default function SiteLoading() {
  return <StorefrontSkeleton />;
}
