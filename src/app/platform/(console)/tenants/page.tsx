import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CreateTenant } from "@/components/platform/create-tenant";
import { FilterBar } from "@/components/platform/filter-bar";
import { Pagination, PlatformHeader, StatusBadge } from "@/components/platform/ui";
import { PageSkeleton } from "@/components/workspace/page-header";
import { buildHref, firstParam, formatCount, formatDate, isUuidLike, pageParam, pageWindow, pickParam, type SearchParams } from "@/lib/platform-display";
import { env } from "@/server/env";
import { listPlans } from "@/server/platform/plans";
import { listTenants } from "@/server/platform/tenants";
import { platformGuard } from "../../_lib/guard";

export const metadata: Metadata = { title: "Tenants" };

const PATH = "/platform/tenants";
const PAGE_SIZE = 25;
const STATUSES = ["active", "suspended"] as const;
const SORTS = ["created_desc", "created_asc", "name_asc", "name_desc", "members_desc"] as const;
const SORT_LABELS: Record<(typeof SORTS)[number], string> = {
  created_desc: "Newest first",
  created_asc: "Oldest first",
  name_asc: "Name, A to Z",
  name_desc: "Name, Z to A",
  members_desc: "Most members",
};

export default function TenantsPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Tenants {...props} />
    </Suspense>
  );
}

async function Tenants({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { actor, isOwner } = await platformGuard();
  const params = await searchParams;

  const search = firstParam(params.q).slice(0, 100);
  const status = pickParam(params.status, STATUSES);
  const planParam = firstParam(params.plan);
  const planId = isUuidLike(planParam) ? planParam : undefined;
  const sort = pickParam(params.sort, SORTS) ?? "created_desc";
  const page = pageParam(params.page);

  const [plans, result] = await Promise.all([
    listPlans(actor),
    listTenants(actor, { search: search || undefined, status, planId, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);

  const rootDomain = env().ROOT_DOMAIN;
  const pager = pageWindow(result.total, page, PAGE_SIZE);
  const query = { q: search, status, plan: planId, sort: sort === "created_desc" ? undefined : sort };
  const filtered = Boolean(search || status || planId);

  return (
    <>
      <PlatformHeader
        kicker="Every workspace on Wayfold, with its owner, plan and standing."
        title="Tenants"
        actions={
          isOwner ? (
            <CreateTenant
              plans={plans.map((plan) => ({ code: plan.code, name: plan.name, isDefault: plan.isDefault }))}
              rootDomain={rootDomain}
              defaultOpen={firstParam(params.new) === "1"}
            />
          ) : null
        }
      />

      <FilterBar
        path={PATH}
        search={{ name: "q", label: "Search tenants", placeholder: "Search name, address or owner e-mail", value: search }}
        selects={[
          {
            name: "status",
            label: "Status",
            value: status ?? "",
            options: [
              { value: "", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
            ],
          },
          {
            name: "plan",
            label: "Plan",
            value: planId ?? "",
            options: [{ value: "", label: "All plans" }, ...plans.map((plan) => ({ value: plan.id, label: plan.name }))],
          },
          {
            name: "sort",
            label: "Sort by",
            value: sort === "created_desc" ? "" : sort,
            alwaysOn: true,
            options: SORTS.map((value) => ({ value: value === "created_desc" ? "" : value, label: SORT_LABELS[value] })),
          },
        ]}
      />

      <div className="card overflow-hidden">
        {result.items.length === 0 ? (
          <div className="p-14 text-center">
            <p className="font-bold">{filtered ? "No tenants match" : page > 1 ? "Nothing on this page" : "No tenants yet"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered
                ? "Try another status, plan or search term."
                : page > 1
                  ? "The list is shorter than this page number."
                  : isOwner
                    ? "Create the first workspace, or wait for a business to sign up."
                    : "Workspaces appear here as businesses sign up."}
            </p>
            {filtered || page > 1 ? (
              <Link href={filtered ? PATH : buildHref(PATH, query)} className="btn btn-outline btn-sm mt-5">
                {filtered ? "Clear filters" : "Back to the first page"}
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="table min-w-[860px]">
                <thead>
                  <tr>
                    <th scope="col" className="pl-6">
                      Tenant
                    </th>
                    <th scope="col">Owner</th>
                    <th scope="col">Plan</th>
                    <th scope="col" className="text-right">
                      Members
                    </th>
                    <th scope="col">Created</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="pr-6">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((tenant) => (
                    <tr key={tenant.id}>
                      <td className="pl-6">
                        <Link href={`${PATH}/${tenant.id}`} className="block font-bold text-primary underline-offset-4 hover:underline">
                          {tenant.name}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {tenant.slug}.{rootDomain}
                        </span>
                      </td>
                      <td className="max-w-[220px] truncate text-muted-foreground">{tenant.ownerEmail ?? "No active owner"}</td>
                      <td>{tenant.plan.name}</td>
                      <td className="text-right tabular-nums">{formatCount(tenant.memberCount)}</td>
                      <td className="whitespace-nowrap text-muted-foreground">{formatDate(tenant.createdAt)}</td>
                      <td>
                        <StatusBadge kind="tenant" status={tenant.status} />
                      </td>
                      <td className="pr-6 text-right">
                        <Link href={`${PATH}/${tenant.id}`} className="btn btn-outline btn-sm" aria-label={`Open ${tenant.name}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y md:hidden">
              {result.items.map((tenant) => (
                <li key={tenant.id}>
                  <Link href={`${PATH}/${tenant.id}`} className="flex flex-col gap-1.5 p-4 hover:bg-muted/50">
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-bold">{tenant.name}</span>
                      <StatusBadge kind="tenant" status={tenant.status} className="shrink-0" />
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{tenant.ownerEmail ?? "No active owner"}</span>
                    <span className="flex justify-between gap-3 text-[13px]">
                      <span>
                        {tenant.plan.name}, {formatCount(tenant.memberCount)} {tenant.memberCount === 1 ? "member" : "members"}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{formatDate(tenant.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <Pagination path={PATH} params={query} pager={pager} total={result.total} noun={result.total === 1 ? "tenant" : "tenants"} />
      </div>
    </>
  );
}
