import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { TeamView } from "@/components/workspace/team/team-view";
import { TEAM_TABS, type TeamViewer } from "@/components/workspace/team/types";
import { enumParam, type SearchParams } from "@/lib/booking-display";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";
import { getEntitlements } from "@/server/billing/limits";
import { PERMISSIONS } from "@/server/rbac/permissions";
import { countSeats } from "@/server/team/access";
import { listInvitations } from "@/server/team/invitations";
import { listMembers } from "@/server/team/members";
import { listRoles } from "@/server/team/roles";

export const metadata = { title: "Team & roles" };

export default function TeamPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton rows={6} />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const workspace = await requireWorkspace("team.view");
  const tab = enumParam((await searchParams).tab, TEAM_TABS) ?? "members";
  const now = new Date();

  // One transaction is one connection: its queries run one after another.
  const { members, invitations, roles, seats, limit } = await inWorkspace(workspace, async (scope) => {
    const members = await listMembers(scope);
    const invitations = await listInvitations(scope);
    const roles = await listRoles(scope);
    const seats = await countSeats(scope, now);
    const { limits } = await getEntitlements(scope);
    return { members, invitations, roles, seats, limit: limits.maxTeamMembers };
  });

  const viewer: TeamViewer = {
    userId: workspace.user.id,
    isOwner: workspace.isOwner,
    permissions: workspace.permissions,
    canManageTeam: can(workspace, "team.manage"),
    canManageRoles: can(workspace, "roles.manage"),
    canSeeBilling: can(workspace, "billing.view"),
    ownRoleId: members.find((member) => member.userId === workspace.user.id)?.roleId ?? null,
  };

  return (
    <>
      <PageHeader title="Team & roles" description="Who can work in this workspace, and what each of them can see and change." />
      <TeamView
        initialTab={tab}
        members={members}
        // Accepted and withdrawn invitations are history; the activity log keeps them.
        invitations={invitations.filter((invitation) => invitation.status === "pending" || invitation.status === "expired")}
        roles={roles}
        viewer={viewer}
        seats={{ used: seats.total, limit }}
        catalogue={PERMISSIONS}
        timezone={workspace.tenant.timezone}
        nowIso={now.toISOString()}
      />
    </>
  );
}
