import "server-only";
import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { and, asc, count, eq, ne } from "drizzle-orm";
import { recordAudit } from "../audit";
import { assertFeature } from "../billing/limits";
import { guardedWrite, requireId } from "../content/shared";
import type { TenantScope } from "../db/context";
import { tenantDomains } from "../db/schema";
import { env } from "../env";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../errors";
import { withTimeout } from "../integrations/http";
import { classifyHost } from "../tenancy/hosts";

export const MAX_DOMAINS = 10;
export const VERIFICATION_LABEL = "_wayfold";
export const VERIFICATION_PREFIX = "wayfold-verify=";
export const DNS_TIMEOUT_MS = 5_000;

const TAKEN = "That domain is already connected to another workspace.";

/** Looks up TXT records: one array of chunks per record, as `node:dns` returns them. */
export type TxtResolver = (hostname: string) => Promise<string[][]>;

export class DomainNotVerifiedError extends AppError {
  constructor() {
    super(
      "domain_not_verified",
      "We could not find the verification record yet. DNS changes can take up to an hour to appear; check the record and try again.",
      409,
    );
  }
}

export interface DomainView {
  id: string;
  domain: string;
  status: "pending" | "verified";
  isPrimary: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
  /** The DNS record to publish while the claim is pending; null once verified. */
  verification: { type: "TXT"; name: string; value: string } | null;
}

type Row = typeof tenantDomains.$inferSelect;

function toView(row: Row): DomainView {
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    isPrimary: row.isPrimary,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    verification:
      row.status === "pending"
        ? { type: "TXT", name: `${VERIFICATION_LABEL}.${row.domain}`, value: `${VERIFICATION_PREFIX}${row.verificationToken}` }
        : null,
  };
}

const stripPort = (host: string) => host.toLowerCase().replace(/:\d+$/, "");

/**
 * Reduces what a person pastes ("https://Tours.Example.com/") to a bare host
 * name and checks it is one a storefront could be served on.
 */
export function normaliseDomain(input: string): string {
  const invalid = () => new ValidationError(undefined, { domain: ["Enter a domain name such as tours.example.com."] });
  if (typeof input !== "string") throw invalid();
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
  // Room for the `_wayfold.` label inside the 253-character DNS limit.
  if (!host || host.length > 253 - VERIFICATION_LABEL.length - 1) throw invalid();

  const root = stripPort(env().ROOT_DOMAIN);
  const app = stripPort(env().APP_HOST);
  if (host === root || host.endsWith(`.${root}`) || host === app) {
    throw new ValidationError(undefined, { domain: ["That address belongs to Wayfold. Connect a domain you own."] });
  }

  // The same classifier the request proxy uses, so a domain accepted here is
  // one the proxy will actually route as a custom domain.
  const target = classifyHost(host, { rootDomain: root, appHost: app });
  if (target.kind !== "custom" || target.site !== host) throw invalid();
  return host;
}

async function findRow(scope: TenantScope, id: string): Promise<Row> {
  requireId(id, "Domain");
  const [row] = await scope.tx
    .select()
    .from(tenantDomains)
    .where(and(eq(tenantDomains.tenantId, scope.tenantId), eq(tenantDomains.id, id)))
    .limit(1);
  // Same answer whether the id is unknown or belongs to another workspace.
  if (!row) throw new NotFoundError("Domain");
  return row;
}

/** True when a different workspace has already proven ownership of the host. */
async function verifiedElsewhere(scope: TenantScope, domain: string): Promise<boolean> {
  // Verified domains are readable across workspaces (host resolution needs
  // them); pending claims and every token stay private to their owner.
  const rows = await scope.tx
    .select({ id: tenantDomains.id })
    .from(tenantDomains)
    .where(and(eq(tenantDomains.domain, domain), eq(tenantDomains.status, "verified"), ne(tenantDomains.tenantId, scope.tenantId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * This workspace's domains. The tenant filter is essential here, not just
 * belt and braces: without it the query would also return other workspaces'
 * verified domains.
 */
export async function listDomains(scope: TenantScope): Promise<DomainView[]> {
  const rows = await scope.tx
    .select()
    .from(tenantDomains)
    .where(eq(tenantDomains.tenantId, scope.tenantId))
    .orderBy(asc(tenantDomains.createdAt), asc(tenantDomains.id));
  return rows.map(toView);
}

/**
 * Files a claim on a domain and returns the TXT record to publish. Nothing is
 * served on the domain until `verifyDomain` finds that record.
 */
export async function addDomain(scope: TenantScope, domain: string): Promise<DomainView> {
  await assertFeature(scope, "customDomain");
  const host = normaliseDomain(domain);

  const [usage] = await scope.tx.select({ total: count() }).from(tenantDomains).where(eq(tenantDomains.tenantId, scope.tenantId));
  if ((usage?.total ?? 0) >= MAX_DOMAINS) throw new ConflictError(`A workspace can connect up to ${MAX_DOMAINS} domains. Remove one first.`);
  if (await verifiedElsewhere(scope, host)) throw new ConflictError(TAKEN);

  const [row] = await guardedWrite(
    scope,
    { unique: { tenant_domains_tenant_domain_key: "You have already added that domain." } },
    (tx) =>
      tx
        .insert(tenantDomains)
        .values({ tenantId: scope.tenantId, domain: host, verificationToken: randomBytes(20).toString("hex") })
        .returning(),
  );
  await recordAudit(scope, { action: "domain.added", targetType: "domain", targetId: row!.id, metadata: { domain: host } });
  return toView(row!);
}

async function hasVerificationRecord(row: Row, resolver: TxtResolver, timeoutMs: number): Promise<boolean> {
  // A row without a token has nothing to prove ownership with; the bare
  // prefix must never count as a match.
  if (!row.verificationToken) return false;
  const expected = `${VERIFICATION_PREFIX}${row.verificationToken}`;
  try {
    const records = await withTimeout(timeoutMs, () => resolver(`${VERIFICATION_LABEL}.${row.domain}`));
    // A long TXT value arrives split into chunks; join before comparing.
    return records.some((chunks) => chunks.join("").trim() === expected);
  } catch {
    // No such name, no TXT data, a slow or failing name server: all of them
    // mean "not proven yet", and none of them is worth showing verbatim.
    return false;
  }
}

/**
 * Checks DNS for the workspace's own token and, when it is there, marks the
 * domain verified so storefront requests on it resolve to this workspace.
 */
export async function verifyDomain(
  scope: TenantScope,
  id: string,
  resolver: TxtResolver = resolveTxt,
  timeoutMs: number = DNS_TIMEOUT_MS,
): Promise<DomainView> {
  await assertFeature(scope, "customDomain");
  const row = await findRow(scope, id);
  if (row.status === "verified") return toView(row);

  if (!(await hasVerificationRecord(row, resolver, timeoutMs))) throw new DomainNotVerifiedError();
  if (await verifiedElsewhere(scope, row.domain)) throw new ConflictError(TAKEN);

  // The partial unique index on verified hosts settles any race between two
  // workspaces verifying the same domain at once: exactly one wins.
  // The token is erased in the same statement. Verified rows are readable by
  // every connection (host resolution), and a spent token has no further use.
  const [updated] = await guardedWrite(scope, { unique: { tenant_domains_verified_domain_key: TAKEN } }, (tx) =>
    tx
      .update(tenantDomains)
      .set({ status: "verified", verifiedAt: new Date(), verificationToken: "" })
      .where(and(eq(tenantDomains.tenantId, scope.tenantId), eq(tenantDomains.id, id)))
      .returning(),
  );
  await recordAudit(scope, { action: "domain.verified", targetType: "domain", targetId: id, metadata: { domain: row.domain } });
  return toView(updated!);
}

/** Allowed on any plan, so a downgraded workspace can still disconnect a domain. */
export async function removeDomain(scope: TenantScope, id: string): Promise<void> {
  const row = await findRow(scope, id);
  await scope.tx.delete(tenantDomains).where(and(eq(tenantDomains.tenantId, scope.tenantId), eq(tenantDomains.id, id)));
  await recordAudit(scope, { action: "domain.removed", targetType: "domain", targetId: id, metadata: { domain: row.domain } });
}

/**
 * Makes a verified domain the workspace's canonical address, or with `null`
 * goes back to the Wayfold sub-domain.
 */
export async function setPrimaryDomain(scope: TenantScope, id: string | null): Promise<DomainView[]> {
  if (id !== null) {
    await assertFeature(scope, "customDomain");
    const row = await findRow(scope, id);
    if (row.status !== "verified") throw new ConflictError("Verify this domain before making it your main address.");
  }

  await scope.tx
    .update(tenantDomains)
    .set({ isPrimary: false })
    .where(and(eq(tenantDomains.tenantId, scope.tenantId), eq(tenantDomains.isPrimary, true)));
  if (id !== null) {
    await scope.tx
      .update(tenantDomains)
      .set({ isPrimary: true })
      .where(and(eq(tenantDomains.tenantId, scope.tenantId), eq(tenantDomains.id, id)));
  }
  await recordAudit(scope, { action: "domain.primary_changed", targetType: "domain", ...(id ? { targetId: id } : {}) });
  return listDomains(scope);
}
