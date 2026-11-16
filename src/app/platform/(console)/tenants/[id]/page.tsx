import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LimitOverridesButton } from "@/components/platform/limit-overrides";
import {
  ActivateTenantButton,
  CancelSubscriptionButton,
  ChangePlanButton,
  EditTenantButton,
  IssueInvoiceButton,
  RenewSubscriptionButton,
  RequestSupportButton,
  SuspendTenantButton,
  TransferOwnerButton,
} from "@/components/platform/tenant-actions";
import { ActivityList, Details, Meter, NotSet, PlatformHeader, Section, StatusBadge } from "@/components/platform/ui";
import { PageSkeleton } from "@/components/workspace/page-header";
import { addDays, formatMoney, todayIn } from "@/lib/dates";
import { formatBytes, formatCount, formatDate, formatDateTime, formatLimit, LIMIT_KEYS, LIMIT_LABELS, type LimitKey } from "@/lib/platform-display";
import { env } from "@/server/env";
import { NotFoundError } from "@/server/errors";
import { INTEGRATION_CATEGORIES } from "@/server/integrations/types";
import { listPlatformAudit } from "@/server/platform/audit";
import { listPlans } from "@/server/platform/plans";
import { getTenantDetail, type TenantDetail } from "@/server/platform/tenants";
import { tenantOrigin } from "@/server/tenancy/hosts";
import { platformGuard } from "../../../_lib/guard";

export const metadata: Metadata = { title: "Tenant" };

const FEATURES: { key: "customDomain" | "platformStorage" | "promotions" | "removeBranding"; label: string }[] = [
  { key: "customDomain", label: "Custom domain" },
  { key: "platformStorage", label: "Platform media storage" },
  { key: "promotions", label: "Discounts and offers" },
  { key: "removeBranding", label: "No Wayfold branding" },
];

export default function TenantPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Tenant {...props} />
    </Suspense>
  );
}

async function loadTenant(actor: Parameters<typeof getTenantDetail>[0], id: string): Promise<TenantDetail> {
  try {
    return await getTenantDetail(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

async function Tenant({ params }: { params: Promise<{ id: string }> }) {
  const { actor, isOwner } = await platformGuard();
  const { id } = await params;
  const detail = await loadTenant(actor, id);
  const [plans, activity] = await Promise.all([isOwner ? listPlans(actor) : Promise.resolve([]), listPlatformAudit(actor, { tenantId: id, limit: 10 })]);

  const { profile, plan, subscription, limits, usage: used, domains, administrators, integrations } = detail;
  const rootDomain = env().ROOT_DOMAIN;
  const protocol = env().APP_URL.startsWith("https://") ? "https" : "http";
  const storefront = tenantOrigin(profile.slug, { rootDomain, appHost: env().APP_HOST }, protocol);
  const today = todayIn("UTC");
  const suspended = profile.status === "suspended";

  const usedBy: Record<LimitKey, number> = {
    maxTeamMembers: used.teamMembers,
    maxPublishedTours: used.publishedTours,
    maxStorageMb: used.storageMb,
    maxBookingsPerMonth: used.bookingsThisMonth,
  };
  const reading = (key: LimitKey): string => {
    const limit = limits.effective[key];
    if (key === "maxStorageMb") return `${formatBytes(used.storageBytes)} of ${limit === null ? "unlimited" : formatBytes(limit * 1024 * 1024)}`;
    return `${formatCount(usedBy[key])} of ${formatLimit(limit).toLowerCase()} ${LIMIT_LABELS[key].unit}`;
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb mb-3">
        <Link href="/platform/tenants" className="underline-offset-4 hover:underline">
          Tenants
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-foreground">
          {profile.name}
        </span>
      </nav>

      <PlatformHeader
        kicker={`${profile.slug}.${rootDomain}, created ${formatDate(profile.createdAt)}`}
        title={profile.name}
        badge={<StatusBadge kind="tenant" status={profile.status} />}
        actions={
          <>
            <RequestSupportButton tenantId={profile.id} name={profile.name} />
            {isOwner ? (
              <>
                <EditTenantButton tenantId={profile.id} name={profile.name} slug={profile.slug} rootDomain={rootDomain} />
                {suspended ? <ActivateTenantButton tenantId={profile.id} name={profile.name} /> : <SuspendTenantButton tenantId={profile.id} name={profile.name} />}
              </>
            ) : null}
          </>
        }
      />

      {suspended ? (
        <div role="status" className="alert alert-destructive mb-5">
          <p className="font-semibold">This workspace is suspended. Its members are locked out and its storefront is offline.</p>
          <p className="mt-0.5">Reason: {profile.suspendedReason ?? "none recorded"}</p>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section id="profile" title="Profile">
            <div className="card-content">
              <Details
                items={[
                  {
                    label: "Storefront",
                    value: (
                      <a href={storefront} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
                        {profile.slug}.{rootDomain}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ),
                  },
                  { label: "Tagline", value: profile.tagline || <NotSet /> },
                  { label: "Contact e-mail", value: profile.email || <NotSet /> },
                  { label: "Phone", value: profile.phone || <NotSet /> },
                  { label: "Website", value: profile.website || <NotSet /> },
                  { label: "Currency", value: profile.currency },
                  { label: "Timezone", value: profile.timezone },
                  { label: "Onboarding", value: profile.onboardingCompleted ? "Completed" : "Not finished" },
                  { label: "Last updated", value: formatDateTime(profile.updatedAt) },
                ]}
              />
            </div>
          </Section>

          <Section
            id="plan"
            title="Plan and subscription"
            description={`${plan.name}: ${formatMoney(plan.priceMonthly, plan.currency)} a month, ${formatMoney(plan.priceYearly, plan.currency)} a year`}
            actions={
              <Link href={`/platform/billing?tenant=${profile.id}`} className="btn btn-ghost btn-sm">
                View invoices
              </Link>
            }
          >
            <div className="card-content flex flex-col gap-5">
              {subscription ? (
                <Details
                  items={[
                    { label: "Status", value: <StatusBadge kind="subscription" status={subscription.status} /> },
                    { label: "Billing cycle", value: subscription.cycle === "yearly" ? "Yearly" : "Monthly" },
                    { label: "Current period", value: `${formatDate(subscription.currentPeriodStart)} to ${formatDate(subscription.currentPeriodEnd)}` },
                    {
                      label: "Renewal",
                      value:
                        subscription.status === "cancelled"
                          ? "Cancelled"
                          : subscription.cancelAtPeriodEnd
                            ? `Ends on ${formatDate(subscription.currentPeriodEnd)}, not renewed`
                            : "Continues until cancelled",
                    },
                    { label: "Billed through", value: subscription.provider === "manual" ? "Manual invoicing" : subscription.provider },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">This workspace has no subscription record. Changing its plan creates one.</p>
              )}

              <ul className="flex flex-wrap gap-1.5" aria-label="Plan features">
                {FEATURES.map((feature) => (
                  <li key={feature.key} className={plan.features[feature.key] ? "badge badge-secondary" : "badge badge-outline text-muted-foreground"}>
                    {feature.label}: {plan.features[feature.key] ? "included" : "not included"}
                  </li>
                ))}
              </ul>

              {isOwner ? (
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <ChangePlanButton
                    tenantId={profile.id}
                    plans={plans.map((entry) => ({ id: entry.id, name: entry.name, priceMonthly: entry.priceMonthly, priceYearly: entry.priceYearly, currency: entry.currency }))}
                    currentPlanId={plan.id}
                    currentCycle={subscription?.cycle ?? null}
                  />
                  <IssueInvoiceButton tenantId={profile.id} currency={plan.currency} periodStart={today} periodEnd={addDays(today, 29)} />
                  {subscription ? <RenewSubscriptionButton tenantId={profile.id} cycle={subscription.cycle} periodEnd={subscription.currentPeriodEnd} /> : null}
                  {subscription && subscription.status !== "cancelled" && !subscription.cancelAtPeriodEnd ? (
                    <CancelSubscriptionButton tenantId={profile.id} name={profile.name} periodEnd={subscription.currentPeriodEnd} />
                  ) : null}
                </div>
              ) : null}
            </div>
          </Section>

          <Section
            id="limits"
            title="Limits and usage"
            description="What this workspace may use, and how much of it is in use now"
            actions={
              isOwner ? <LimitOverridesButton tenantId={profile.id} planName={plan.name} planLimits={limits.plan} overrides={limits.overrides} /> : null
            }
          >
            <div className="card-content flex flex-col gap-5">
              {LIMIT_KEYS.map((key) => (
                <Meter
                  key={key}
                  label={LIMIT_LABELS[key].label}
                  used={usedBy[key]}
                  limit={limits.effective[key]}
                  reading={reading(key)}
                  note={
                    limits.overrides[key] !== undefined
                      ? `Override. The ${plan.name} plan allows ${formatLimit(limits.plan[key]).toLowerCase()}.`
                      : `From the ${plan.name} plan`
                  }
                />
              ))}
            </div>
          </Section>

          <Section
            id="administrators"
            title="Administrators"
            description="Members holding the Owner or Administrator role"
            className="overflow-hidden"
            actions={
              isOwner ? (
                <TransferOwnerButton
                  tenantId={profile.id}
                  name={profile.name}
                  administrators={administrators.filter((person) => person.status === "active").map((person) => ({ name: person.name, email: person.email }))}
                />
              ) : null
            }
          >
            {administrators.length === 0 ? (
              <p className="card-content text-sm text-muted-foreground">
                Nobody holds the Owner or Administrator role. {isOwner ? "Transfer ownership to an existing account so someone can manage this workspace." : ""}
              </p>
            ) : (
              <>
                <ul className="divide-y border-t md:hidden">
                  {administrators.map((person) => (
                    <li key={person.userId} className="flex flex-col gap-1 px-5 py-3.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-bold">{person.name}</span>
                        <span className="badge badge-outline shrink-0">{person.roleName}</span>
                      </span>
                      <span className="truncate text-[13px] text-muted-foreground">{person.email}</span>
                      <span className="text-xs text-muted-foreground">
                        {person.status === "active" ? "Active" : "Deactivated"}, e-mail {person.emailVerified ? "verified" : "not verified"}, joined{" "}
                        {formatDate(person.joinedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto border-t md:block">
                  <table className="table min-w-[620px]">
                    <thead>
                      <tr>
                        <th scope="col" className="pl-6">
                          Name
                        </th>
                        <th scope="col">Role</th>
                        <th scope="col">E-mail verified</th>
                        <th scope="col">Joined</th>
                        <th scope="col" className="pr-6">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {administrators.map((person) => (
                        <tr key={person.userId}>
                          <td className="pl-6">
                            <span className="block font-semibold">{person.name}</span>
                            <span className="text-xs text-muted-foreground">{person.email}</span>
                          </td>
                          <td>{person.roleName}</td>
                          <td className="text-muted-foreground">{person.emailVerified ? "Yes" : "No"}</td>
                          <td className="whitespace-nowrap text-muted-foreground">{formatDate(person.joinedAt)}</td>
                          <td className="pr-6">
                            <StatusBadge kind="member" status={person.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Section id="domains" title="Domains" description={plan.features.customDomain ? "Custom domains this workspace has added" : "The plan does not include custom domains"}>
            {domains.length === 0 ? (
              <p className="card-content text-sm text-muted-foreground">
                No custom domain. The storefront is served at {profile.slug}.{rootDomain}.
              </p>
            ) : (
              <ul className="divide-y border-t">
                {domains.map((domain) => (
                  <li key={domain.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
                    <span className="min-w-0 break-all font-semibold">
                      {domain.domain}
                      {domain.isPrimary ? <span className="ml-2 text-xs font-normal text-muted-foreground">Primary</span> : null}
                    </span>
                    <StatusBadge kind="domain" status={domain.status} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="integrations" title="Integrations" description="Connection health only. Credentials never leave the workspace.">
            {integrations.length === 0 ? (
              <p className="card-content text-sm text-muted-foreground">This workspace has not connected any provider.</p>
            ) : (
              <ul className="divide-y border-t">
                {integrations.map((connection) => (
                  <li key={connection.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="block font-semibold">
                        {connection.label || connection.provider}
                        {connection.isDefault ? <span className="ml-2 text-xs font-normal text-muted-foreground">Default</span> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {INTEGRATION_CATEGORIES[connection.category as keyof typeof INTEGRATION_CATEGORIES] ?? connection.category},{" "}
                        {connection.lastTestedAt ? `tested ${formatDateTime(connection.lastTestedAt)}` : "never tested"}
                      </span>
                    </span>
                    <StatusBadge kind="connection" status={connection.status} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="activity"
            title="Recent activity"
            description={`The latest ${Math.min(activity.items.length, 10)} of ${formatCount(activity.total)} events in this workspace's audit log`}
            className="overflow-hidden"
            actions={
              activity.total > 0 ? (
                <Link href={`/platform/system?tenant=${profile.id}`} className="btn btn-ghost btn-sm">
                  Full log
                </Link>
              ) : null
            }
          >
            {activity.items.length === 0 ? (
              <p className="card-content text-sm text-muted-foreground">Nothing has been recorded for this workspace yet.</p>
            ) : (
              <ActivityList rows={activity.items} showTenant={false} stacked className="border-t" />
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
