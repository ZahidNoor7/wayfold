import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withTenant } from "@/server/db/context";
import { tenantDomains } from "@/server/db/schema";
import {
  addDomain,
  listDomains,
  MAX_DOMAINS,
  normaliseDomain,
  removeDomain,
  setPrimaryDomain,
  verifyDomain,
  type DomainView,
  type TxtResolver,
} from "@/server/settings/domains";
import { resolveSite } from "@/server/tenancy/resolve";
import { createTenant, randomId, unique, type TenantFixture } from "../../helpers/fixtures";
import { asOwner, auditActions, failure } from "../content/seed";

const host = (prefix = "tours") => `${unique(prefix)}.example.com`;

/** A DNS that publishes exactly the given records. */
const dnsWith =
  (records: Record<string, string[][]>): TxtResolver =>
  async (name) => {
    const found = records[name];
    if (!found) throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: "ENOTFOUND" });
    return found;
  };

/** The TXT record of a claim that is still pending. */
function record(domain: DomainView): NonNullable<DomainView["verification"]> {
  if (!domain.verification) throw new Error(`${domain.domain} is already verified and has no record to publish.`);
  return domain.verification;
}

/** A DNS in which the owner has published the record `addDomain` asked for. */
const dnsFor = (domain: DomainView): TxtResolver => dnsWith({ [record(domain).name]: [[record(domain).value]] });

async function verified(tenant: TenantFixture, domain = host()): Promise<DomainView> {
  const added = await asOwner(tenant)((scope) => addDomain(scope, domain));
  return asOwner(tenant)((scope) => verifyDomain(scope, added.id, dnsFor(added)));
}

describe("custom domains: adding", () => {
  it("normalises the host and returns the TXT record to publish", async () => {
    const tenant = await createTenant();
    const name = host("My-Tours");
    const domain = await asOwner(tenant)((scope) => addDomain(scope, `  HTTPS://${name.toUpperCase()}./some/path?x=1 `));

    expect(domain).toMatchObject({ domain: name.toLowerCase(), status: "pending", isPrimary: false, verifiedAt: null });
    expect(record(domain).type).toBe("TXT");
    expect(record(domain).name).toBe(`_wayfold.${name.toLowerCase()}`);
    expect(record(domain).value).toMatch(/^wayfold-verify=[0-9a-f]{40}$/);

    expect(await asOwner(tenant)((scope) => listDomains(scope))).toEqual([domain]);
    expect(await auditActions(tenant)).toContain("domain.added");
    // A claim alone serves nothing.
    expect(await resolveSite(domain.domain)).toBeNull();
  });

  it("gives every claim its own token", async () => {
    const tenant = await createTenant();
    const [a, b] = await asOwner(tenant)(async (scope) => [await addDomain(scope, host()), await addDomain(scope, host())]);
    expect(record(a!).value).not.toBe(record(b!).value);
  });

  it("rejects anything that is not a public host name", async () => {
    const tenant = await createTenant();
    for (const input of [
      "",
      "   ",
      "localhost",
      "example",
      "exa mple.com",
      "1.2.3.4",
      "example.com:8080",
      "-bad.example.com",
      "bad-.example.com",
      "under_score.example.com",
      "münchen.example.com",
      "a..example.com",
      `${"a".repeat(64)}.example.com`,
      `${"a.".repeat(125)}com`,
      "user@example.com",
      "example.c",
    ]) {
      expect(await failure(() => asOwner(tenant)((scope) => addDomain(scope, input))), input).toMatchObject({
        name: "ValidationError",
        fieldErrors: { domain: ["Enter a domain name such as tours.example.com."] },
      });
    }
    expect(() => normaliseDomain(42 as never)).toThrow();
    expect(await asOwner(tenant)((scope) => listDomains(scope))).toEqual([]);
  });

  it("rejects the platform's own domain, its sub-domains and the app host", async () => {
    const tenant = await createTenant();
    // ROOT_DOMAIN is wayfold.test and APP_HOST app.wayfold.test in the test environment.
    for (const input of ["wayfold.test", "WAYFOLD.TEST.", "www.wayfold.test", "other-biz.wayfold.test", "a.b.wayfold.test", "app.wayfold.test", "https://app.wayfold.test/login"]) {
      expect(await failure(() => asOwner(tenant)((scope) => addDomain(scope, input))), input).toMatchObject({
        name: "ValidationError",
        fieldErrors: { domain: ["That address belongs to Wayfold. Connect a domain you own."] },
      });
    }
    // A look-alike that merely ends in the same letters is an ordinary domain.
    expect(normaliseDomain("notwayfold.test")).toBe("notwayfold.test");
    expect(normaliseDomain("wayfold.test.example.com")).toBe("wayfold.test.example.com");
  });

  it("refuses the same domain twice in one workspace, keeping the transaction usable", async () => {
    const tenant = await createTenant();
    const name = host();
    const outcome = await asOwner(tenant)(async (scope) => {
      await addDomain(scope, name);
      const again = await failure(() => addDomain(scope, name.toUpperCase()));
      return { again, list: await listDomains(scope) };
    });
    expect(outcome.again).toMatchObject({ name: "ConflictError", code: "conflict" });
    expect(outcome.list).toHaveLength(1);
  });

  it("caps the number of domains per workspace", async () => {
    const tenant = await createTenant();
    await asOwner(tenant)(async (scope) => {
      for (let i = 0; i < MAX_DOMAINS; i++) await addDomain(scope, host());
    });
    expect(await failure(() => asOwner(tenant)((scope) => addDomain(scope, host())))).toMatchObject({ name: "ConflictError" });
    expect(await asOwner(tenant)((scope) => listDomains(scope))).toHaveLength(MAX_DOMAINS);
  });
});

describe("custom domains: plan feature", () => {
  it("is refused on a plan without custom domains, except for looking and removing", async () => {
    const tenant = await createTenant({ plan: { features: { customDomain: false } } });
    // A domain left over from a better plan.
    const [leftover] = await withTenant(tenant.tenantId, ({ tx }) =>
      tx.insert(tenantDomains).values({ domain: host(), status: "verified", verifiedAt: new Date(), verificationToken: "legacy" }).returning(),
    );

    for (const call of [
      () => asOwner(tenant)((scope) => addDomain(scope, host())),
      () => asOwner(tenant)((scope) => verifyDomain(scope, leftover!.id, dnsWith({}))),
      () => asOwner(tenant)((scope) => setPrimaryDomain(scope, leftover!.id)),
    ]) {
      expect(await failure(call)).toMatchObject({ name: "LimitExceededError", code: "plan_limit" });
    }

    expect(await asOwner(tenant)((scope) => listDomains(scope))).toHaveLength(1);
    expect(await asOwner(tenant)((scope) => setPrimaryDomain(scope, null))).toHaveLength(1);
    await asOwner(tenant)((scope) => removeDomain(scope, leftover!.id));
    expect(await asOwner(tenant)((scope) => listDomains(scope))).toEqual([]);
  });
});

describe("custom domains: verifying", () => {
  it("verifies when DNS publishes the workspace's token, and the storefront starts resolving", async () => {
    const tenant = await createTenant();
    const added = await asOwner(tenant)((scope) => addDomain(scope, host()));
    const resolver = vi.fn(
      dnsWith({
        // Unrelated records and a value split into chunks, as real DNS returns them.
        [record(added).name]: [["v=spf1 include:example.net ~all"], [record(added).value.slice(0, 20), record(added).value.slice(20)]],
      }),
    );

    const result = await asOwner(tenant)((scope) => verifyDomain(scope, added.id, resolver));

    expect(resolver).toHaveBeenCalledExactlyOnceWith(`_wayfold.${added.domain}`);
    expect(result).toMatchObject({ id: added.id, status: "verified", isPrimary: false, verification: null });
    expect(result.verifiedAt).toBeInstanceOf(Date);
    expect(await auditActions(tenant)).toContain("domain.verified");
    expect(await resolveSite(added.domain)).toMatchObject({ id: tenant.tenantId, slug: tenant.slug });
  });

  it("erases the token once it has done its job", async () => {
    const tenant = await createTenant();
    const domain = await verified(tenant);

    const [row] = await withTenant(tenant.tenantId, ({ tx }) => tx.select().from(tenantDomains).where(eq(tenantDomains.id, domain.id)));
    expect(row).toMatchObject({ status: "verified", verificationToken: "" });
    // Nothing left to publish, in the result or in later reads.
    expect(domain.verification).toBeNull();
    expect(await asOwner(tenant)((scope) => listDomains(scope))).toMatchObject([{ id: domain.id, verification: null }]);
    expect(JSON.stringify(await asOwner(tenant)((scope) => listDomains(scope)))).not.toContain("wayfold-verify=");
  });

  it("never accepts the bare prefix as proof for a claim that has no token", async () => {
    const tenant = await createTenant();
    const name = host();
    const [row] = await withTenant(tenant.tenantId, ({ tx }) => tx.insert(tenantDomains).values({ domain: name, verificationToken: "" }).returning());
    const resolver = vi.fn(dnsWith({ [`_wayfold.${name}`]: [["wayfold-verify="]] }));

    expect(await failure(() => asOwner(tenant)((scope) => verifyDomain(scope, row!.id, resolver)))).toMatchObject({ name: "DomainNotVerifiedError" });
    expect(resolver).not.toHaveBeenCalled();
    expect(await resolveSite(name)).toBeNull();
  });

  it("stays pending while the record is missing, wrong or unreachable", async () => {
    const tenant = await createTenant();
    const added = await asOwner(tenant)((scope) => addDomain(scope, host()));
    const name = record(added).name;

    const resolvers: Record<string, TxtResolver> = {
      "no such name": dnsWith({}),
      "no TXT data": async () => {
        throw Object.assign(new Error("queryTxt ENODATA"), { code: "ENODATA" });
      },
      "server failure": async () => {
        throw Object.assign(new Error("queryTxt ESERVFAIL"), { code: "ESERVFAIL" });
      },
      "empty answer": dnsWith({ [name]: [] }),
      "someone else's token": dnsWith({ [name]: [["wayfold-verify=0000000000000000000000000000000000000000"]] }),
      "token without the prefix": dnsWith({ [name]: [[record(added).value.replace("wayfold-verify=", "")]] }),
      "token inside a longer value": dnsWith({ [name]: [[`${record(added).value}-extra`]] }),
      "record on the bare domain only": dnsWith({ [added.domain]: [[record(added).value]] }),
    };
    for (const [label, resolver] of Object.entries(resolvers)) {
      expect(await failure(() => asOwner(tenant)((scope) => verifyDomain(scope, added.id, resolver))), label).toMatchObject({
        name: "DomainNotVerifiedError",
        code: "domain_not_verified",
      });
    }

    expect(await asOwner(tenant)((scope) => listDomains(scope))).toMatchObject([{ status: "pending", verifiedAt: null }]);
    expect(await resolveSite(added.domain)).toBeNull();
    expect(await auditActions(tenant)).not.toContain("domain.verified");
  });

  it("gives up on a name server that never answers", async () => {
    const tenant = await createTenant();
    const added = await asOwner(tenant)((scope) => addDomain(scope, host()));
    const never: TxtResolver = () => new Promise(() => undefined);

    const started = Date.now();
    expect(await failure(() => asOwner(tenant)((scope) => verifyDomain(scope, added.id, never, 30)))).toMatchObject({
      name: "DomainNotVerifiedError",
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await asOwner(tenant)((scope) => listDomains(scope))).toMatchObject([{ status: "pending" }]);
  });

  it("does not ask DNS again once a domain is verified", async () => {
    const tenant = await createTenant();
    const domain = await verified(tenant);
    const resolver = vi.fn(dnsWith({}));
    expect(await asOwner(tenant)((scope) => verifyDomain(scope, domain.id, resolver))).toMatchObject({ status: "verified" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("lets only one workspace hold a verified host", async () => {
    const first = await createTenant();
    const second = await createTenant();
    const name = host("contested");

    // Both file a claim; each gets its own token.
    const claimOfSecond = await asOwner(second)((scope) => addDomain(scope, name));
    const claimOfFirst = await asOwner(first)((scope) => addDomain(scope, name));
    await asOwner(first)((scope) => verifyDomain(scope, claimOfFirst.id, dnsFor(claimOfFirst)));

    // Even with its own token published, the second workspace is too late.
    expect(await failure(() => asOwner(second)((scope) => verifyDomain(scope, claimOfSecond.id, dnsFor(claimOfSecond))))).toMatchObject({
      name: "ConflictError",
      code: "conflict",
    });
    expect(await asOwner(second)((scope) => listDomains(scope))).toMatchObject([{ status: "pending" }]);
    expect(await resolveSite(name)).toMatchObject({ id: first.tenantId });

    // And a third cannot even file a claim on it any more.
    const third = await createTenant();
    expect(await failure(() => asOwner(third)((scope) => addDomain(scope, name)))).toMatchObject({ name: "ConflictError" });

    // Once the holder lets go, the waiting claim can be verified.
    await asOwner(first)((scope) => removeDomain(scope, claimOfFirst.id));
    expect(await asOwner(second)((scope) => verifyDomain(scope, claimOfSecond.id, dnsFor(claimOfSecond)))).toMatchObject({ status: "verified" });
    expect(await resolveSite(name)).toMatchObject({ id: second.tenantId });
  });

  it("reports unknown domain ids as not found", async () => {
    const tenant = await createTenant();
    const missing = randomId();
    for (const call of [
      () => asOwner(tenant)((scope) => verifyDomain(scope, missing, dnsWith({}))),
      () => asOwner(tenant)((scope) => removeDomain(scope, missing)),
      () => asOwner(tenant)((scope) => setPrimaryDomain(scope, missing)),
      // Ids that are not even UUIDs: not found, not a database error.
      () => asOwner(tenant)((scope) => verifyDomain(scope, "example.com", dnsWith({}))),
      () => asOwner(tenant)((scope) => removeDomain(scope, "42")),
      () => asOwner(tenant)((scope) => setPrimaryDomain(scope, "")),
    ]) {
      expect(await failure(call)).toMatchObject({ name: "NotFoundError", code: "not_found" });
    }
  });
});

describe("custom domains: primary and removal", () => {
  it("makes one verified domain primary at a time", async () => {
    const tenant = await createTenant();
    const one = await verified(tenant);
    const two = await verified(tenant);
    const pending = await asOwner(tenant)((scope) => addDomain(scope, host()));
    const primaryIds = (domains: DomainView[]) => domains.filter((domain) => domain.isPrimary).map((domain) => domain.id);

    expect(primaryIds(await asOwner(tenant)((scope) => setPrimaryDomain(scope, one.id)))).toEqual([one.id]);
    expect(primaryIds(await asOwner(tenant)((scope) => setPrimaryDomain(scope, two.id)))).toEqual([two.id]);

    expect(await failure(() => asOwner(tenant)((scope) => setPrimaryDomain(scope, pending.id)))).toMatchObject({ name: "ConflictError" });
    expect(primaryIds(await asOwner(tenant)((scope) => listDomains(scope)))).toEqual([two.id]);

    expect(primaryIds(await asOwner(tenant)((scope) => setPrimaryDomain(scope, null)))).toEqual([]);
    expect((await auditActions(tenant)).filter((action) => action === "domain.primary_changed")).toHaveLength(3);
  });

  it("removes a domain so it stops resolving", async () => {
    const tenant = await createTenant();
    const domain = await verified(tenant);
    expect(await resolveSite(domain.domain)).not.toBeNull();

    await asOwner(tenant)((scope) => removeDomain(scope, domain.id));

    expect(await asOwner(tenant)((scope) => listDomains(scope))).toEqual([]);
    expect(await resolveSite(domain.domain)).toBeNull();
    expect(await auditActions(tenant)).toContain("domain.removed");
    const rows = await withTenant(tenant.tenantId, ({ tx }) => tx.select().from(tenantDomains).where(eq(tenantDomains.id, domain.id)));
    expect(rows).toEqual([]);
  });
});
