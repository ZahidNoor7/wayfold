import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { SettingsBreadcrumb } from "@/components/workspace/settings/settings-links";
import { SupportAccess, type GrantItem } from "@/components/workspace/settings/support-access";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { listSupportGrants } from "@/server/support";
import { listMembers } from "@/server/team/members";

export const metadata = { title: "Support access" };

export default function SupportAccessPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const workspace = await requireWorkspace("support.manage");
  const { grants, members } = await inWorkspace(workspace, async (scope) => {
    const grants = await listSupportGrants(scope);
    const members = await listMembers(scope);
    return { grants, members };
  });

  const names = new Map(members.map((member) => [member.userId, member.name]));
  const nameOf = (userId: string | null) => {
    if (!userId) return null;
    if (userId === workspace.user.id) return "you";
    return names.get(userId) ?? "a former team member";
  };

  // Who at Wayfold asked is not shown to the workspace, so the request id stays on the server.
  const items: GrantItem[] = grants.map((grant) => ({
    id: grant.id,
    reason: grant.reason,
    status: grant.status,
    createdAt: grant.createdAt,
    decidedAt: grant.decidedAt,
    expiresAt: grant.expiresAt,
    decidedByName: nameOf(grant.decidedBy),
  }));

  return (
    <>
      <SettingsBreadcrumb current="Support access" canOpenSettings={can(workspace, "workspace.manage")} />
      <PageHeader title="Support access" description="Decide when Wayfold support may look inside your workspace to help you." />
      <div className="mb-6 max-w-3xl rounded-lg border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          While access is open, support can view your workspace the way your team sees it, but cannot change anything, and never sees your
          billing. Access ends on its own when the time you chose runs out, and you can revoke it sooner. Every support visit, from
          sign-in to sign-out, is recorded in the {can(workspace, "audit.view") ? (
            <Link href="/workspace/activity" className="font-semibold text-foreground underline underline-offset-4">
              activity log
            </Link>
          ) : (
            "activity log"
          )}
          .
        </p>
      </div>
      <SupportAccess grants={items} timezone={workspace.tenant.timezone} renderedAt={new Date()} />
    </>
  );
}
