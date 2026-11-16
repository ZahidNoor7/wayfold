import type { InvitationView } from "@/server/team/invitations";
import type { MemberView } from "@/server/team/members";
import type { RoleView } from "@/server/team/roles";

export type { InvitationView, MemberView, RoleView };

/** What the signed-in member may do on this screen. The server checks again. */
export interface TeamViewer {
  userId: string;
  isOwner: boolean;
  permissions: readonly string[];
  canManageTeam: boolean;
  canManageRoles: boolean;
  canSeeBilling: boolean;
  /** The role the viewer holds, which they may not edit. */
  ownRoleId: string | null;
}

export interface SeatUsage {
  used: number;
  limit: number | null;
}

export type TeamTab = "members" | "invitations" | "roles";
export const TEAM_TABS: readonly TeamTab[] = ["members", "invitations", "roles"];
