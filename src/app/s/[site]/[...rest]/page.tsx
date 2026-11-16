import { notFound } from "next/navigation";

/** Any unknown path on a storefront gets the storefront's own 404 page. */
export default function UnknownStorefrontPath() {
  notFound();
}
