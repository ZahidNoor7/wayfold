/**
 * Display rules for the Team & roles screen. The server enforces every one of
 * these rules again; the screen uses them to disable what cannot work and to
 * say why before anyone tries.
 */

export interface ActorRights {
  isOwner: boolean;
  permissions: readonly string[];
}

export interface RoleLike {
  id: string;
  systemKey: string | null;
  isSystem: boolean;
  name: string;
  permissions: readonly string[];
  memberCount: number;
  openInvitationCount: number;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** `4 of 5 seats used (including pending invitations)`. */
export function seatSummary(used: number, limit: number | null): string {
  if (limit === null) return `${plural(used, "seat")} used (including pending invitations). Your plan has no seat limit.`;
  return `${used} of ${plural(limit, "seat")} used (including pending invitations)`;
}

export function seatsFull(used: number, limit: number | null): boolean {
  return limit !== null && used >= limit;
}

/** You cannot hand out more than you hold; only an owner makes owners. */
export function canGrantRole(actor: ActorRights, role: Pick<RoleLike, "systemKey" | "permissions">): boolean {
  if (role.systemKey === "owner") return actor.isOwner;
  if (actor.isOwner) return true;
  return role.permissions.every((permission) => actor.permissions.includes(permission));
}

export function grantableRoles<R extends Pick<RoleLike, "systemKey" | "permissions">>(actor: ActorRights, roles: readonly R[]): R[] {
  return roles.filter((role) => canGrantRole(actor, role));
}

export interface MemberLike {
  userId: string;
  isOwner: boolean;
}

/** Why the actor cannot manage this member, or null when they can. */
export function memberLockReason(member: MemberLike, actor: ActorRights & { userId: string }): string | null {
  if (member.userId === actor.userId) {
    return "This is you. Your own role and access can only be changed by another team member with team access, so nobody can lock themselves out by accident.";
  }
  if (member.isOwner && !actor.isOwner) return "Only an owner can change or remove another owner.";
  return null;
}

/** Why a role cannot be deleted, or null when it can. */
export function roleDeleteBlock(role: Pick<RoleLike, "isSystem" | "memberCount" | "openInvitationCount">): string | null {
  if (role.isSystem) return "Built-in roles cannot be deleted.";
  if (role.memberCount > 0) {
    return `${plural(role.memberCount, "person", "people")} ${role.memberCount === 1 ? "has" : "have"} this role. Move ${role.memberCount === 1 ? "them" : "them all"} to another role before deleting it.`;
  }
  if (role.openInvitationCount > 0) {
    return `${plural(role.openInvitationCount, "open invitation")} ${role.openInvitationCount === 1 ? "uses" : "use"} this role. Revoke ${role.openInvitationCount === 1 ? "it" : "them"} before deleting the role.`;
  }
  return null;
}

/** Why a role cannot be edited, or null when it can. */
export function roleEditBlock(role: Pick<RoleLike, "id" | "systemKey">, ownRoleId: string | null): string | null {
  if (role.systemKey === "owner") return "The Owner role always includes every permission and cannot be changed.";
  if (ownRoleId !== null && role.id === ownRoleId) return "You cannot edit the role you hold yourself. Ask someone else with role access.";
  return null;
}

/** `Expires in 3 days`, `Expires today`, `Expired yesterday`, `Expired 4 days ago`. */
export function invitationExpiry(expiresAt: Date, now: Date): { text: string; expired: boolean } {
  const ms = expiresAt.getTime() - now.getTime();
  const days = Math.floor(Math.abs(ms) / 86_400_000);
  if (ms > 0) {
    if (days === 0) return { text: "Expires today", expired: false };
    return { text: `Expires in ${plural(days, "day")}`, expired: false };
  }
  if (days === 0) return { text: "Expired today", expired: true };
  if (days === 1) return { text: "Expired yesterday", expired: true };
  return { text: `Expired ${plural(days, "day")} ago`, expired: true };
}

export interface PermissionItem {
  key: string;
  description: string;
}

export interface PermissionGroup {
  id: string;
  label: string;
  items: PermissionItem[];
}

/** Areas of the product, in the order the sidebar shows them. Prefix → area. */
const PERMISSION_AREAS: readonly { id: string; label: string; prefixes: readonly string[] }[] = [
  { id: "bookings", label: "Bookings and customers", prefixes: ["bookings", "customers", "exports"] },
  { id: "tours", label: "Tours", prefixes: ["tours"] },
  { id: "content", label: "Website content and media", prefixes: ["content", "reviews", "media"] },
  { id: "promotions", label: "Discounts and offers", prefixes: ["promotions"] },
  { id: "workspace", label: "Workspace settings", prefixes: ["workspace", "branding", "domains", "integrations"] },
  { id: "team", label: "Team and roles", prefixes: ["team", "roles"] },
  { id: "billing", label: "Billing, reports and support", prefixes: ["billing", "analytics", "audit", "support"] },
];

/** The permission catalogue grouped by area for the role editor. Unknown prefixes land in "Other". */
export function groupPermissions(catalogue: Readonly<Record<string, string>>): PermissionGroup[] {
  const groups = PERMISSION_AREAS.map((area) => ({ id: area.id, label: area.label, items: [] as PermissionItem[] }));
  const other: PermissionGroup = { id: "other", label: "Other", items: [] };
  for (const [key, description] of Object.entries(catalogue)) {
    const prefix = key.split(".")[0] ?? key;
    const index = PERMISSION_AREAS.findIndex((area) => area.prefixes.includes(prefix));
    (index === -1 ? other : groups[index]!).items.push({ key, description });
  }
  return [...groups, other].filter((group) => group.items.length > 0);
}

/** `12 of 28 permissions`, or `All permissions`. */
export function permissionCount(granted: number, total: number): string {
  if (total > 0 && granted >= total) return "All permissions";
  return `${granted} of ${plural(total, "permission")}`;
}
