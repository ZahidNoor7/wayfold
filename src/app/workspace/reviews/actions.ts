"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceAction } from "@/server/actions";
import { createReview, deleteReview, setReviewFeatured, setReviewPublished, updateReview, type CreateReviewInput, type UpdateReviewInput } from "@/server/content/reviews";

/*
 * The schemas here only check the envelope (an id, and that the fields are an
 * object). The reviews service validates every field itself and answers with
 * one message per field, which is what the form shows beside each control.
 */
const id = z.string().min(1).max(64);
const fields = z.record(z.string(), z.unknown());

const LIST = "/workspace/reviews";

export const createReviewAction = workspaceAction("reviews.manage", z.object({ fields }), async ({ scope, input }) => {
  const review = await createReview(scope, input.fields as CreateReviewInput);
  revalidatePath(LIST);
  return { id: review.id };
});

export const updateReviewAction = workspaceAction("reviews.manage", z.object({ id, fields }), async ({ scope, input }) => {
  const review = await updateReview(scope, input.id, input.fields as UpdateReviewInput);
  revalidatePath(LIST);
  return { id: review.id };
});

export const setReviewPublishedAction = workspaceAction("reviews.manage", z.object({ id, published: z.boolean() }), async ({ scope, input }) => {
  const review = await setReviewPublished(scope, input.id, input.published);
  revalidatePath(LIST);
  return { id: review.id, isPublished: review.isPublished };
});

export const setReviewFeaturedAction = workspaceAction("reviews.manage", z.object({ id, featured: z.boolean() }), async ({ scope, input }) => {
  const review = await setReviewFeatured(scope, input.id, input.featured);
  revalidatePath(LIST);
  return { id: review.id, isFeatured: review.isFeatured };
});

export const deleteReviewAction = workspaceAction("reviews.manage", z.object({ id }), async ({ scope, input }) => {
  await deleteReview(scope, input.id);
  revalidatePath(LIST);
  return { id: input.id };
});
