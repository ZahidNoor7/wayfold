import { describe, expect, it } from "vitest";
import { describeReviewMedia, moveReviewMedia, pickedReviewMedia, REVIEW_MEDIA_LIMIT, type ReviewMediaChoice } from "./review-media";

const file = (id: string, resourceType: ReviewMediaChoice["resourceType"] = "image") => ({
  id,
  url: `https://res.cloudinary.com/demo/${resourceType}/upload/${id}`,
  alt: `File ${id}`,
  resourceType,
  // Extra fields the picker sends are dropped.
  bytes: 10,
});

describe("pickedReviewMedia", () => {
  it("keeps the picker's order, drops duplicates and extra fields", () => {
    expect(pickedReviewMedia([file("a"), file("b", "video"), file("a")])).toEqual([
      { id: "a", url: file("a").url, alt: "File a", resourceType: "image" },
      { id: "b", url: file("b", "video").url, alt: "File b", resourceType: "video" },
    ]);
  });

  it("stays within the limit", () => {
    const many = Array.from({ length: REVIEW_MEDIA_LIMIT + 3 }, (_, i) => file(String(i)));
    expect(pickedReviewMedia(many)).toHaveLength(REVIEW_MEDIA_LIMIT);
  });

  it("returns nothing for an empty selection", () => {
    expect(pickedReviewMedia([])).toEqual([]);
  });
});

describe("moveReviewMedia", () => {
  const list = ["a", "b", "c"];
  it("moves an item up and down", () => {
    expect(moveReviewMedia(list, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveReviewMedia(list, 2, 0)).toEqual(["c", "a", "b"]);
  });
  it("leaves the list unchanged for no-op or out-of-range moves, without mutating it", () => {
    expect(moveReviewMedia(list, 1, 1)).toEqual(list);
    expect(moveReviewMedia(list, -1, 0)).toEqual(list);
    expect(moveReviewMedia(list, 0, 3)).toEqual(list);
    expect(moveReviewMedia(list, 3, 0)).toEqual(list);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("describeReviewMedia", () => {
  it("counts photos and videos with singular and plural", () => {
    expect(describeReviewMedia([])).toBe("None attached");
    expect(describeReviewMedia([file("a")])).toBe("1 photo");
    expect(describeReviewMedia([file("a"), file("b")])).toBe("2 photos");
    expect(describeReviewMedia([file("v", "video")])).toBe("1 video");
    expect(describeReviewMedia([file("a"), file("v", "video"), file("w", "video")])).toBe("1 photo, 2 videos");
  });
});
