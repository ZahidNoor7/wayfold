/** A review as the dashboard's client components receive it: plain, serialisable data. */
export interface ReviewItem {
  id: string;
  customerName: string;
  country: string;
  rating: number;
  title: string;
  body: string;
  /** `YYYY-MM-DD`. */
  reviewedOn: string;
  isVerified: boolean;
  isFeatured: boolean;
  isPublished: boolean;
  tour: { id: string; title: string } | null;
  avatar: { id: string; url: string } | null;
  /** Photos and videos shared with the review, in display order. */
  media: { id: string; url: string; alt: string; resourceType: "image" | "video" }[];
}

/** A tour a review can be linked to. */
export interface TourOption {
  id: string;
  title: string;
}
