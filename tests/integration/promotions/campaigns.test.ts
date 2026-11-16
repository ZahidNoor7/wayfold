import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { campaigns, campaignTours } from "@/server/db/schema";
import { LimitExceededError, NotFoundError, ValidationError } from "@/server/errors";
import { createCampaign, deleteCampaign, getCampaign, listCampaigns, setCampaignActive, updateCampaign } from "@/server/promotions/campaigns";
import { consumeDiscount } from "@/server/promotions/engine";
import { createTenant, randomId } from "../../helpers/fixtures";
import { asOwner, auditActions, campaignInput, createTour, errorOf, TODAY } from "../../helpers/promotions";

describe("campaigns", () => {
  it("creates a public campaign for all tours with safe defaults", async () => {
    const tenant = await createTenant();
    const view = await asOwner(tenant, (scope) => createCampaign(scope, campaignInput({ code: " autumn15 " }), TODAY));

    expect(view).toMatchObject({
      name: "Autumn harvest",
      code: "AUTUMN15",
      blurb: "",
      type: "percent",
      value: 15,
      appliesToAllTours: true,
      tours: [],
      visibility: "public",
      assignedEmails: [],
      minGuests: 0,
      minChildren: 0,
      bookAheadDays: 0,
      isActive: true,
      uses: 0,
      status: "active",
    });
    expect(await auditActions(tenant, view.id)).toEqual(["promotions.campaign_created"]);
  });

  it("scopes a campaign to chosen tours and drops duplicates", async () => {
    const tenant = await createTenant();
    const [first, second] = [await createTour(tenant, { title: "Alpha" }), await createTour(tenant, { title: "Beta" })];

    const view = await asOwner(tenant, (scope) =>
      createCampaign(scope, campaignInput({ appliesToAllTours: false, tourIds: [second.id, first.id, second.id] }), TODAY),
    );

    expect(view.appliesToAllTours).toBe(false);
    expect(view.tours).toEqual([
      { id: first.id, title: "Alpha" },
      { id: second.id, title: "Beta" },
    ]);
  });

  it("ignores a tour list when the campaign covers all tours", async () => {
    const tenant = await createTenant();
    const tour = await createTour(tenant);
    const view = await asOwner(tenant, (scope) => createCampaign(scope, campaignInput({ appliesToAllTours: true, tourIds: [tour.id] }), TODAY));
    expect(view.tours).toEqual([]);
  });

  it("stores a private campaign's e-mails lower-cased and deduplicated, and none for a public one", async () => {
    const tenant = await createTenant();
    const { privateView, publicView } = await asOwner(tenant, async (scope) => ({
      privateView: await createCampaign(
        scope,
        campaignInput({ visibility: "private", assignedEmails: [" Ada@Example.test ", "ada@example.test", "BOB@example.test"] }),
        TODAY,
      ),
      publicView: await createCampaign(scope, campaignInput({ visibility: "public", assignedEmails: ["ada@example.test"] }), TODAY),
    }));

    expect(privateView.assignedEmails).toEqual(["ada@example.test", "bob@example.test"]);
    expect(publicView.assignedEmails).toEqual([]);
  });

  it.each([
    ["a name shorter than three characters", { name: " ab " }, "name"],
    ["a percentage above 90", { value: 91 }, "value"],
    ["a zero value", { value: 0 }, "value"],
    ["a fractional value", { value: 12.5 }, "value"],
    ["a fixed amount of zero", { type: "fixed" as const, value: 0 }, "value"],
    ["an end date before the start date", { startsOn: "2026-12-01", endsOn: "2026-11-30" }, "endsOn"],
    ["a date that does not exist", { endsOn: "2026-02-30" }, "endsOn"],
    ["no tours when not all tours", { appliesToAllTours: false, tourIds: [] }, "tourIds"],
    ["a tour id that is not an id", { appliesToAllTours: false, tourIds: ["sheki"] }, "tourIds"],
    ["a private campaign without e-mails", { visibility: "private" as const }, "assignedEmails"],
    ["a malformed assigned e-mail", { visibility: "private" as const, assignedEmails: ["not-an-email"] }, "assignedEmails"],
    ["a negative guest minimum", { minGuests: -1 }, "minGuests"],
    ["a negative child minimum", { minChildren: -1 }, "minChildren"],
    ["a negative book-ahead rule", { bookAheadDays: -1 }, "bookAheadDays"],
  ])("rejects %s", async (_name, overrides, field) => {
    const tenant = await createTenant();
    const error = await errorOf(() => asOwner(tenant, (scope) => createCampaign(scope, campaignInput(overrides), TODAY)));

    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors ?? {})).toContain(field);
    expect(await asOwner(tenant, (scope) => listCampaigns(scope, TODAY))).toEqual([]);
  });

  it("accepts a 90% discount, a same-day window and a large fixed amount", async () => {
    const tenant = await createTenant();
    const [percent, fixed] = await asOwner(tenant, async (scope) => [
      await createCampaign(scope, campaignInput({ value: 90, startsOn: TODAY, endsOn: TODAY }), TODAY),
      await createCampaign(scope, campaignInput({ type: "fixed", value: 500_000 }), TODAY),
    ]);
    expect(percent).toMatchObject({ value: 90, status: "active" });
    expect(fixed).toMatchObject({ type: "fixed", value: 500_000 });
  });

  it("turns an unknown tour id into a validation error and writes nothing", async () => {
    const tenant = await createTenant();
    const error = await errorOf(() =>
      asOwner(tenant, (scope) => createCampaign(scope, campaignInput({ appliesToAllTours: false, tourIds: [randomId()] }), TODAY)),
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors).toEqual({ tourIds: ["Choose tours from your own catalogue."] });
    expect(await asOwner(tenant, (scope) => listCampaigns(scope, TODAY))).toEqual([]);
    expect(await auditActions(tenant)).not.toContain("promotions.campaign_created");
  });

  it("derives status from the switch and the date window on every read", async () => {
    const tenant = await createTenant();
    const statuses = await asOwner(tenant, async (scope) => {
      await createCampaign(scope, campaignInput({ name: "Live" }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Later", startsOn: "2026-12-01", endsOn: "2026-12-31" }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Over", startsOn: "2026-10-01", endsOn: "2026-10-31" }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Paused", isActive: false }), TODAY);
      const read = async (today: string) => Object.fromEntries((await listCampaigns(scope, today)).map((c) => [c.name, c.status]));
      return { now: await read(TODAY), inDecember: await read("2026-12-20") };
    });

    expect(statuses.now).toEqual({ Live: "active", Later: "scheduled", Over: "expired", Paused: "inactive" });
    // Nothing was written in between: only the day changed.
    expect(statuses.inDecember).toEqual({ Live: "expired", Later: "active", Over: "expired", Paused: "inactive" });
  });

  it("lists campaigns with their use counts", async () => {
    const tenant = await createTenant();
    const listed = await asOwner(tenant, async (scope) => {
      const used = await createCampaign(scope, campaignInput({ name: "Used twice" }), TODAY);
      await createCampaign(scope, campaignInput({ name: "Unused" }), TODAY);
      const applied = { source: "campaign" as const, refId: used.id, label: "Used twice — 15% off", amount: 100 };
      await consumeDiscount(scope, applied, randomId());
      await consumeDiscount(scope, applied, randomId());
      return listCampaigns(scope, TODAY);
    });

    expect(Object.fromEntries(listed.map((c) => [c.name, c.uses]))).toEqual({ "Used twice": 2, Unused: 0 });
  });

  it("updates every field, replaces the tour list and keeps the use count", async () => {
    const tenant = await createTenant();
    const [first, second] = [await createTour(tenant, { title: "Alpha" }), await createTour(tenant, { title: "Beta" })];

    const updated = await asOwner(tenant, async (scope) => {
      const created = await createCampaign(scope, campaignInput({ appliesToAllTours: false, tourIds: [first.id] }), TODAY);
      await consumeDiscount(scope, { source: "campaign", refId: created.id, label: "x", amount: 1 }, randomId());
      return updateCampaign(
        scope,
        created.id,
        campaignInput({
          name: "Family week",
          type: "fixed",
          value: 30_000,
          appliesToAllTours: false,
          tourIds: [second.id],
          minChildren: 1,
          minGuests: 3,
          bookAheadDays: 30,
          blurb: "Bring the children",
          visibility: "private",
          assignedEmails: ["ada@example.test"],
        }),
        TODAY,
      );
    });

    expect(updated).toMatchObject({
      name: "Family week",
      type: "fixed",
      value: 30_000,
      tours: [{ id: second.id, title: "Beta" }],
      minChildren: 1,
      minGuests: 3,
      bookAheadDays: 30,
      blurb: "Bring the children",
      visibility: "private",
      assignedEmails: ["ada@example.test"],
      uses: 1,
    });
    expect(await auditActions(tenant, updated.id)).toContain("promotions.campaign_updated");
  });

  it("clears the tour list when an edit widens a campaign to all tours", async () => {
    const tenant = await createTenant();
    const tour = await createTour(tenant);
    const { view, links } = await asOwner(tenant, async (scope) => {
      const created = await createCampaign(scope, campaignInput({ appliesToAllTours: false, tourIds: [tour.id] }), TODAY);
      const view = await updateCampaign(scope, created.id, campaignInput({ appliesToAllTours: true }), TODAY);
      return { view, links: await scope.tx.select().from(campaignTours).where(eq(campaignTours.campaignId, created.id)) };
    });
    expect(view).toMatchObject({ appliesToAllTours: true, tours: [] });
    expect(links).toEqual([]);
  });

  it("rejects an invalid edit and leaves the campaign as it was", async () => {
    const tenant = await createTenant();
    const created = await asOwner(tenant, (scope) => createCampaign(scope, campaignInput(), TODAY));

    const error = await errorOf(() => asOwner(tenant, (scope) => updateCampaign(scope, created.id, campaignInput({ value: 95 }), TODAY)));
    expect(error).toBeInstanceOf(ValidationError);
    expect(await asOwner(tenant, (scope) => getCampaign(scope, created.id, TODAY))).toMatchObject({ value: 15 });
  });

  it("pauses and resumes a campaign", async () => {
    const tenant = await createTenant();
    const { paused, resumed, id } = await asOwner(tenant, async (scope) => {
      const created = await createCampaign(scope, campaignInput(), TODAY);
      const paused = await setCampaignActive(scope, created.id, false, TODAY);
      const resumed = await setCampaignActive(scope, created.id, true, TODAY);
      return { paused, resumed, id: created.id };
    });

    expect(paused).toMatchObject({ isActive: false, status: "inactive" });
    expect(resumed).toMatchObject({ isActive: true, status: "active" });
    expect((await auditActions(tenant, id)).sort()).toEqual([
      "promotions.campaign_activated",
      "promotions.campaign_created",
      "promotions.campaign_deactivated",
    ]);
  });

  it("deletes a campaign together with its tour links", async () => {
    const tenant = await createTenant();
    const tour = await createTour(tenant);
    const { id, remaining } = await asOwner(tenant, async (scope) => {
      const created = await createCampaign(scope, campaignInput({ appliesToAllTours: false, tourIds: [tour.id] }), TODAY);
      await deleteCampaign(scope, created.id);
      return {
        id: created.id,
        remaining: {
          campaigns: await scope.tx.select().from(campaigns).where(eq(campaigns.id, created.id)),
          links: await scope.tx.select().from(campaignTours).where(eq(campaignTours.campaignId, created.id)),
        },
      };
    });

    expect(remaining).toEqual({ campaigns: [], links: [] });
    expect(await auditActions(tenant, id)).toContain("promotions.campaign_deleted");
    expect(await errorOf(() => asOwner(tenant, (scope) => getCampaign(scope, id, TODAY)))).toBeInstanceOf(NotFoundError);
  });

  it("answers not found for ids that do not exist", async () => {
    const tenant = await createTenant();
    const missing = randomId();
    for (const run of [
      () => asOwner(tenant, (scope) => getCampaign(scope, missing, TODAY)),
      () => asOwner(tenant, (scope) => updateCampaign(scope, missing, campaignInput(), TODAY)),
      () => asOwner(tenant, (scope) => setCampaignActive(scope, missing, false, TODAY)),
      () => asOwner(tenant, (scope) => deleteCampaign(scope, missing)),
    ]) {
      expect(await errorOf(run)).toBeInstanceOf(NotFoundError);
    }
  });

  it("requires the promotions feature for every mutation, but not for reading", async () => {
    const tenant = await createTenant({ plan: { features: { promotions: false } } });
    const missing = randomId();
    for (const run of [
      () => asOwner(tenant, (scope) => createCampaign(scope, campaignInput(), TODAY)),
      () => asOwner(tenant, (scope) => updateCampaign(scope, missing, campaignInput(), TODAY)),
      () => asOwner(tenant, (scope) => setCampaignActive(scope, missing, true, TODAY)),
      () => asOwner(tenant, (scope) => deleteCampaign(scope, missing)),
    ]) {
      expect(await errorOf(run)).toBeInstanceOf(LimitExceededError);
    }
    expect(await asOwner(tenant, (scope) => listCampaigns(scope, TODAY))).toEqual([]);
  });
});
