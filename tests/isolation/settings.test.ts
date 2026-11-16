import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { appDatabase } from "@/server/db/client";
import { withTenant, withUser, withoutTenant } from "@/server/db/context";
import { tenantDomains, tenantSettings, tenants } from "@/server/db/schema";
import { withPlatform } from "@/server/platform/db";
import { addDomain, listDomains, removeDomain, setPrimaryDomain, verifyDomain, type DomainView, type TxtResolver } from "@/server/settings/domains";
import { defaultSiteContent, getSiteContent, updateSiteContent } from "@/server/settings/site-content";
import { readSiteDocument } from "@/server/settings/tenant-settings";
import { completeOnboarding, DEFAULT_BRANDING, getWorkspaceProfile, updateBranding, updateWorkspaceProfile } from "@/server/settings/workspace";
import { resolveSite } from "@/server/tenancy/resolve";
import { createTenant, unique, type TenantFixture } from "../helpers/fixtures";
import { asOwner, asVisitor, failure, seedMedia } from "../integration/content/seed";

const NOT_FOUND = { name: "NotFoundError", code: "not_found" };

/** The TXT record of a claim that is still pending. */
function record(domain: DomainView): NonNullable<DomainView["verification"]> {
  if (!domain.verification) throw new Error(`${domain.domain} is already verified and has no record to publish.`);
  return domain.verification;
}

function dnsFor(domain: DomainView): TxtResolver {
  const { name, value } = record(domain);
  return async (asked) => (asked === name ? [[value]] : []);
}

async function platformTenant(tenant: TenantFixture) {
  const [row] = await withPlatform((tx) => tx.select().from(tenants).where(eq(tenants.id, tenant.tenantId)));
  return row!;
}

describe("tenant isolation: site content", () => {
  it("B neither sees nor changes A's website content", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await asOwner(a)(async (scope) => {
      await updateSiteContent(scope, "hero", { headline: "A's private headline" });
      await updateSiteContent(scope, "faq", [{ question: "A's question?", answer: "A's answer." }]);
      await updateSiteContent(scope, "legal", { privacy: "A's privacy policy." });
    });

    // B starts from the defaults, with nothing of A's in it.
    expect(await asVisitor(b)((scope) => getSiteContent(scope))).toEqual(defaultSiteContent());
    expect(await asOwner(b)((scope) => readSiteDocument(scope))).toEqual({});

    await asOwner(b)(async (scope) => {
      await updateSiteContent(scope, "hero", { headline: "B's headline" });
      await updateSiteContent(scope, "faq", []);
      await updateSiteContent(scope, "legal", { privacy: "" });
    });

    const contentOfA = await asVisitor(a)((scope) => getSiteContent(scope));
    expect(contentOfA.hero.headline).toBe("A's private headline");
    expect(contentOfA.faq).toEqual([{ question: "A's question?", answer: "A's answer." }]);
    expect(contentOfA.legal.privacy).toBe("A's privacy policy.");
    expect((await asVisitor(b)((scope) => getSiteContent(scope))).hero.headline).toBe("B's headline");
  });

  it("B cannot use A's media as its hero image or portrait", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const media = await seedMedia(a);

    expect(await failure(() => asOwner(b)((scope) => updateSiteContent(scope, "hero", { imageMediaId: media.id })))).toMatchObject({
      name: "ValidationError",
      fieldErrors: { imageMediaId: ["Choose an image from your media library."] },
    });
    expect(await failure(() => asOwner(b)((scope) => updateSiteContent(scope, "about", { portraitMediaId: media.id })))).toMatchObject({
      name: "ValidationError",
      fieldErrors: { portraitMediaId: ["Choose an image from your media library."] },
    });
    expect(await asOwner(b)((scope) => readSiteDocument(scope))).toEqual({});

    // The owner of the image can.
    expect((await asOwner(a)((scope) => updateSiteContent(scope, "hero", { imageMediaId: media.id }))).imageMediaId).toBe(media.id);
  });

  it("the database keeps settings rows apart, with or without the service", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await asOwner(a)((scope) => updateSiteContent(scope, "footer", { blurb: "A's footer." }));

    const seen = await withTenant(b.tenantId, async ({ tx }) => ({
      all: await tx.select().from(tenantSettings),
      byId: await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, a.tenantId)),
      updated: await tx.update(tenantSettings).set({ site: {} }).where(eq(tenantSettings.tenantId, a.tenantId)).returning(),
      deleted: await tx.delete(tenantSettings).where(eq(tenantSettings.tenantId, a.tenantId)).returning(),
    }));
    expect(seen).toEqual({ all: [], byId: [], updated: [], deleted: [] });
    expect(await withoutTenant((tx) => tx.select().from(tenantSettings))).toEqual([]);
    expect((await asVisitor(a)((scope) => getSiteContent(scope))).footer.blurb).toBe("A's footer.");
  });
});

describe("tenant isolation: workspace profile and branding", () => {
  it("B's profile edits never reach A, even when the payload names A", async () => {
    const a = await createTenant({ name: "Workspace A" });
    const b = await createTenant({ name: "Workspace B" });
    await asOwner(a)((scope) => updateWorkspaceProfile(scope, { tagline: "A's tagline", email: "a@example.test" }));

    const result = await asOwner(b)((scope) =>
      updateWorkspaceProfile(scope, { id: a.tenantId, tenantId: a.tenantId, slug: a.slug, name: "Renamed by B", email: "b@example.test" } as never),
    );
    expect(result).toMatchObject({ id: b.tenantId, slug: b.slug, name: "Renamed by B", email: "b@example.test" });

    expect(await asOwner(a)((scope) => getWorkspaceProfile(scope))).toMatchObject({
      id: a.tenantId,
      name: "Workspace A",
      tagline: "A's tagline",
      email: "a@example.test",
    });
    expect(await asOwner(b)((scope) => getWorkspaceProfile(scope))).toMatchObject({ id: b.tenantId, tagline: "" });
  });

  it("B's branding and onboarding never reach A, and B cannot use A's logo", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const logoOfA = await seedMedia(a);
    await asOwner(a)((scope) => updateBranding(scope, { theme: "caspian", logoMediaId: logoOfA.id, accent: "200 80% 40%" }));

    expect(await failure(() => asOwner(b)((scope) => updateBranding(scope, { logoMediaId: logoOfA.id })))).toMatchObject({
      name: "ValidationError",
      fieldErrors: { logoMediaId: ["Choose an image from your media library."] },
    });

    await asOwner(b)((scope) => updateBranding(scope, { theme: "graphite", mode: "dark", tenantId: a.tenantId } as never));
    await asOwner(b)((scope) => completeOnboarding(scope));

    expect(await platformTenant(a)).toMatchObject({
      branding: { theme: "caspian", mode: "light", radius: "md", font: "classic", logoMediaId: logoOfA.id, accent: "200 80% 40%" },
      onboardingCompletedAt: null,
    });
    const profileOfB = await asOwner(b)((scope) => getWorkspaceProfile(scope));
    expect(profileOfB.branding).toEqual({ ...DEFAULT_BRANDING, theme: "graphite", mode: "dark" });
    expect(profileOfB.logoUrl).toBeNull();
    expect(profileOfB.onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it("a logo id planted in B's branding never resolves to A's file", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const logoOfA = await seedMedia(a);
    // Bypass the service: write A's media id straight into B's own row.
    await withTenant(b.tenantId, ({ tx }) =>
      tx.update(tenants).set({ branding: { ...DEFAULT_BRANDING, logoMediaId: logoOfA.id } }).where(eq(tenants.id, b.tenantId)),
    );
    const profile = await asOwner(b)((scope) => getWorkspaceProfile(scope));
    expect(profile.logoUrl).toBeNull();
    expect(JSON.stringify(profile)).not.toContain(logoOfA.url);
  });

  it("the database refuses B writing A's tenant row", async () => {
    const a = await createTenant({ name: "Workspace A" });
    const b = await createTenant();
    const touched = await withTenant(b.tenantId, ({ tx }) =>
      tx
        .update(tenants)
        .set({ name: "Defaced", branding: { ...DEFAULT_BRANDING, theme: "graphite" } })
        .where(eq(tenants.id, a.tenantId))
        .returning({ id: tenants.id }),
    );
    expect(touched).toEqual([]);
    expect(await platformTenant(a)).toMatchObject({ name: "Workspace A", branding: DEFAULT_BRANDING });
  });
});

describe("tenant isolation: custom domains", () => {
  it("B never sees A's pending domain or its token", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const pending = await asOwner(a)((scope) => addDomain(scope, `${unique("pending")}.example.com`));
    const token = record(pending).value.replace("wayfold-verify=", "");

    expect(await asOwner(b)((scope) => listDomains(scope))).toEqual([]);

    // Not through the service, and not through the database either.
    const raw = await withTenant(b.tenantId, async ({ tx }) => ({
      all: await tx.select().from(tenantDomains),
      byId: await tx.select().from(tenantDomains).where(eq(tenantDomains.id, pending.id)),
      byDomain: await tx.select().from(tenantDomains).where(eq(tenantDomains.domain, pending.domain)),
      byToken: await tx.select().from(tenantDomains).where(eq(tenantDomains.verificationToken, token)),
    }));
    expect({ byId: raw.byId, byDomain: raw.byDomain, byToken: raw.byToken }).toEqual({ byId: [], byDomain: [], byToken: [] });
    // Other workspaces' verified hosts are visible by design (host
    // resolution); a pending claim, and anything of A's here, is not.
    expect(raw.all.filter((row) => row.status !== "verified" || row.tenantId === a.tenantId)).toEqual([]);
    expect(JSON.stringify(raw.all)).not.toContain(token);
    expect(await withoutTenant((tx) => tx.select().from(tenantDomains).where(eq(tenantDomains.id, pending.id)))).toEqual([]);
  });

  it("after verification no connection outside A can read a token for the host", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const name = `${unique("live")}.example.com`;
    const stillPending = await asOwner(a)((scope) => addDomain(scope, `${unique("pending")}.example.com`));
    const added = await asOwner(a)((scope) => addDomain(scope, name));
    const token = record(added).value.replace("wayfold-verify=", "");
    expect(token).toMatch(/^[0-9a-f]{40}$/);

    await asOwner(a)((scope) => verifyDomain(scope, added.id, dnsFor(added)));

    const byHost = eq(tenantDomains.domain, name);
    const columns = { domain: tenantDomains.domain, status: tenantDomains.status, token: tenantDomains.verificationToken };
    const withOwner = { ...columns, tenantId: tenantDomains.tenantId };
    const views = {
      // The row is public (host resolution needs it); its token is spent.
      "another workspace": await withTenant(b.tenantId, ({ tx }) => tx.select(columns).from(tenantDomains).where(byHost)),
      "another workspace's owner": await withTenant(b.tenantId, ({ tx }) => tx.select(columns).from(tenantDomains).where(byHost), { userId: b.ownerId }),
      "a signed-in user with no workspace": await withUser(b.ownerId, ({ tx }) => tx.select(columns).from(tenantDomains).where(byHost)),
      "no context at all": await withoutTenant((tx) => tx.select(columns).from(tenantDomains).where(byHost)),
    };
    for (const [who, rows] of Object.entries(views)) {
      expect(rows, who).toEqual([{ domain: name, status: "verified", token: "" }]);
    }

    // A raw pooled connection outside any transaction, bypassing every helper.
    const raw = await appDatabase().execute<{ token: string }>(sql`select verification_token as token from tenant_domains where domain = ${name}`);
    expect(raw.rows).toEqual([{ token: "" }]);

    // The token cannot be found by value either, by anyone, A included.
    for (const run of [
      () => withTenant(b.tenantId, ({ tx }) => tx.select().from(tenantDomains).where(eq(tenantDomains.verificationToken, token))),
      () => withoutTenant((tx) => tx.select().from(tenantDomains).where(eq(tenantDomains.verificationToken, token))),
      () => withTenant(a.tenantId, ({ tx }) => tx.select().from(tenantDomains).where(eq(tenantDomains.verificationToken, token))),
    ]) {
      expect(await run()).toEqual([]);
    }

    // Looking at everything an outsider can see: no row of A's carries a token.
    const visibleToB = await withTenant(b.tenantId, ({ tx }) => tx.select(withOwner).from(tenantDomains));
    expect(visibleToB.filter((row) => row.tenantId === a.tenantId)).toEqual([{ domain: name, status: "verified", token: "", tenantId: a.tenantId }]);
    const visibleToNobody = await withoutTenant((tx) => tx.select(withOwner).from(tenantDomains));
    expect(visibleToNobody.filter((row) => row.tenantId === a.tenantId)).toEqual([{ domain: name, status: "verified", token: "", tenantId: a.tenantId }]);

    // A's other, still pending, claim keeps its token, and keeps it private.
    const pendingToken = record(stillPending).value.replace("wayfold-verify=", "");
    expect(JSON.stringify(visibleToB)).not.toContain(pendingToken);
    expect(JSON.stringify(visibleToNobody)).not.toContain(pendingToken);
    expect(await withTenant(b.tenantId, ({ tx }) => tx.select().from(tenantDomains).where(eq(tenantDomains.id, stillPending.id)))).toEqual([]);
    const ownList = await asOwner(a)((scope) => listDomains(scope));
    expect(ownList.find((domain) => domain.id === stillPending.id)?.verification?.value).toBe(`wayfold-verify=${pendingToken}`);
    expect(ownList.find((domain) => domain.id === added.id)?.verification).toBeNull();
  });

  it("B's list never includes A's verified domain, though the host itself is public", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const added = await asOwner(a)((scope) => addDomain(scope, `${unique("live")}.example.com`));
    await asOwner(a)((scope) => verifyDomain(scope, added.id, dnsFor(added)));
    const own = await asOwner(b)((scope) => addDomain(scope, `${unique("mine")}.example.com`));

    // Row-level security alone would show A's verified row here; the
    // service's own tenant filter is what keeps it out.
    const rawVisible = await withTenant(b.tenantId, ({ tx }) => tx.select({ id: tenantDomains.id }).from(tenantDomains));
    expect(rawVisible.map((row) => row.id)).toContain(added.id);

    const list = await asOwner(b)((scope) => listDomains(scope));
    expect(list.map((domain) => domain.id)).toEqual([own.id]);
    expect(JSON.stringify(list)).not.toContain(added.domain);
    expect(JSON.stringify(await asOwner(b)((scope) => setPrimaryDomain(scope, null)))).not.toContain(added.domain);
  });

  it("B cannot verify, remove or promote A's domains by id", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const pending = await asOwner(a)((scope) => addDomain(scope, `${unique("pending")}.example.com`));
    const live = await asOwner(a)((scope) => addDomain(scope, `${unique("live")}.example.com`));
    await asOwner(a)((scope) => verifyDomain(scope, live.id, dnsFor(live)));
    await asOwner(a)((scope) => setPrimaryDomain(scope, live.id));

    for (const call of [
      // Even with A's exact record in DNS, the id is not B's to verify.
      () => asOwner(b)((scope) => verifyDomain(scope, pending.id, dnsFor(pending))),
      () => asOwner(b)((scope) => verifyDomain(scope, live.id, dnsFor(live))),
      () => asOwner(b)((scope) => removeDomain(scope, pending.id)),
      () => asOwner(b)((scope) => removeDomain(scope, live.id)),
      () => asOwner(b)((scope) => setPrimaryDomain(scope, live.id)),
      () => asOwner(b)((scope) => setPrimaryDomain(scope, pending.id)),
    ]) {
      expect(await failure(call)).toMatchObject(NOT_FOUND);
    }

    // B clearing its own primary must not clear A's.
    await asOwner(b)((scope) => setPrimaryDomain(scope, null));
    expect(await asOwner(a)((scope) => listDomains(scope))).toMatchObject([
      { id: pending.id, status: "pending", isPrimary: false },
      { id: live.id, status: "verified", isPrimary: true },
    ]);
    expect(await resolveSite(live.domain)).toMatchObject({ id: a.tenantId });
  });

  it("B cannot verify a domain already verified by A, nor take it over", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const name = `${unique("contested")}.example.com`;

    const claimOfB = await asOwner(b)((scope) => addDomain(scope, name));
    const claimOfA = await asOwner(a)((scope) => addDomain(scope, name));
    expect(record(claimOfA).value).not.toBe(record(claimOfB).value);
    await asOwner(a)((scope) => verifyDomain(scope, claimOfA.id, dnsFor(claimOfA)));

    // A's token does not verify B's claim...
    expect(await failure(() => asOwner(b)((scope) => verifyDomain(scope, claimOfB.id, dnsFor(claimOfA))))).toMatchObject({
      name: "DomainNotVerifiedError",
    });
    // ...and B's own token is refused because the host is taken.
    expect(await failure(() => asOwner(b)((scope) => verifyDomain(scope, claimOfB.id, dnsFor(claimOfB))))).toMatchObject({
      name: "ConflictError",
      code: "conflict",
    });
    // The database agrees, should the service ever be bypassed.
    const code = await withTenant(b.tenantId, ({ tx }) =>
      tx.update(tenantDomains).set({ status: "verified" }).where(eq(tenantDomains.id, claimOfB.id)),
    ).then(
      () => undefined,
      (error: { code?: string; cause?: { code?: string } }) => error.code ?? error.cause?.code,
    );
    expect(code).toBe("23505");

    expect(await asOwner(b)((scope) => listDomains(scope))).toMatchObject([{ id: claimOfB.id, status: "pending" }]);
    expect(await failure(() => asOwner(b)((scope) => setPrimaryDomain(scope, claimOfB.id)))).toMatchObject({ name: "ConflictError" });
    expect(await resolveSite(name)).toMatchObject({ id: a.tenantId });
  });
});
