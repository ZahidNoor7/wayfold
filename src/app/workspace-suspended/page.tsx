import { CirclePause } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, AuthCardSkeleton } from "@/components/auth/auth-card";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SUPPORT_EMAIL, supportMailto } from "@/components/auth/support";
import { getWorkspace, requireUser } from "@/server/auth/guards";
import { listWorkspaces } from "@/server/auth/workspace";

export default function WorkspaceSuspendedPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const session = await requireUser();
  const resolution = await getWorkspace();
  // Reactivated, or never suspended: there is nothing to explain.
  if (resolution?.ok) redirect("/workspace");
  if (!resolution || resolution.reason !== "suspended") redirect("/workspaces");

  const workspaces = await listWorkspaces(session.user.id);
  const suspended = workspaces.find((workspace) => workspace.tenantId === session.activeTenantId);
  const name = suspended?.name ?? "This workspace";
  const others = workspaces.filter((workspace) => workspace.tenantId !== session.activeTenantId && workspace.status === "active").length;

  return (
    <AuthCard
      mark={<CirclePause aria-hidden="true" />}
      title={`${name} is paused`}
      description="Wayfold has suspended this workspace, so its dashboard and its public website are unavailable for now."
    >
      <div className="flex flex-col gap-6">
        <ul className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 text-left text-sm leading-relaxed">
          <li>
            <strong className="font-semibold">Nothing has been deleted.</strong> Tours, bookings, customers and media are kept exactly as they were.
          </li>
          <li>
            <strong className="font-semibold">Guests cannot book for now.</strong> Your website is offline until the workspace is active again.
          </li>
          <li>
            <strong className="font-semibold">Support can tell you why,</strong> and what it takes to bring the workspace back.
          </li>
        </ul>

        <div className="flex flex-col gap-3">
          <a href={supportMailto(`Suspended workspace: ${name}`)} className="btn btn-default btn-lg w-full">
            Contact support
          </a>
          <Link href="/workspaces" className="btn btn-outline btn-lg w-full">
            {others > 0 ? "Switch workspace" : "View your workspaces"}
          </Link>
          <SignOutButton className="btn btn-ghost w-full" />
        </div>

        <p className="text-sm text-muted-foreground">
          Or write to <span className="break-all font-semibold text-foreground">{SUPPORT_EMAIL}</span> from the address you sign in with.
        </p>
      </div>
    </AuthCard>
  );
}
