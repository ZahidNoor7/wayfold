import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CreateWorkspaceForm, type PlanOption } from "@/components/onboarding/create-workspace-form";
import { WorkspaceList, type WorkspaceCard } from "@/components/onboarding/workspace-list";
import { planLimits, planPrice } from "@/components/marketing/plan-format";
import { rootDomain, workspaceAddress } from "@/components/marketing/urls";
import { requireUser } from "@/server/auth/guards";
import { getPlatformRole, listWorkspaces } from "@/server/auth/workspace";
import { listPublicPlans } from "@/server/billing/overview";
import { isSelfServicePlan } from "@/server/onboarding";

export default function WorkspacesPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="skeleton h-10 w-64 max-w-full" />
        <div className="skeleton h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="skeleton h-40" />
        <div className="skeleton h-40" />
      </div>
    </div>
  );
}

async function Content() {
  const session = await requireUser();
  if (!session.user.emailVerified) redirect("/verify-email");

  const [workspaces, plans, platformRole] = await Promise.all([
    listWorkspaces(session.user.id),
    listPublicPlans(),
    getPlatformRole(session.user.id),
  ]);

  const cards: WorkspaceCard[] = workspaces.map((workspace) => ({
    tenantId: workspace.tenantId,
    name: workspace.name,
    address: workspaceAddress(workspace.slug),
    roleName: workspace.roleName,
    status: workspace.status,
    current: workspace.tenantId === session.activeTenantId,
  }));

  const planOptions: PlanOption[] = plans.map((plan) => ({
    code: plan.code,
    name: plan.name,
    description: plan.description,
    price: planPrice(plan),
    limits: planLimits(plan),
    selectable: isSelfServicePlan({ isPublic: true, priceMonthly: plan.priceMonthly, priceYearly: plan.priceYearly }),
  }));

  const first = workspaces.length === 0;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <h1 className="font-display text-3xl font-semibold leading-tight text-primary sm:text-4xl">
            {first ? "Create your first workspace" : "Your workspaces"}
          </h1>
          <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
            {first
              ? "A workspace is one tour business: its website, tours, bookings and team."
              : "Open a workspace to manage its website, tours and bookings."}{" "}
            Signed in as <span className="font-semibold text-foreground">{session.user.email}</span>.
          </p>
        </div>
        {platformRole ? (
          <Link href="/platform" className="btn btn-outline">
            Platform administration
          </Link>
        ) : null}
      </header>

      {first ? null : <WorkspaceList workspaces={cards} />}

      <section aria-labelledby="create-workspace" className="card p-6 sm:p-9">
        {first ? (
          <h2 id="create-workspace" className="sr-only">
            Workspace details
          </h2>
        ) : (
          <div className="mb-7">
            <h2 id="create-workspace" className="font-display text-2xl font-semibold leading-tight text-primary sm:text-3xl">
              Create another workspace
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">For a second business or brand, with its own website and team.</p>
          </div>
        )}
        <CreateWorkspaceForm plans={planOptions} rootDomain={rootDomain()} />
      </section>
    </div>
  );
}
