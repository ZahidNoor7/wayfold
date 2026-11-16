"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { SwapIn } from "@/components/motion";
import { InvitationsSection } from "./invitations-section";
import { MembersSection } from "./members-section";
import { RolesSection } from "./roles-section";
import { TEAM_TABS, type InvitationView, type MemberView, type RoleView, type SeatUsage, type TeamTab, type TeamViewer } from "./types";

interface TeamViewProps {
  initialTab: TeamTab;
  members: MemberView[];
  invitations: InvitationView[];
  roles: RoleView[];
  viewer: TeamViewer;
  seats: SeatUsage;
  catalogue: Readonly<Record<string, string>>;
  timezone: string;
  nowIso: string;
}

const TAB_LABELS: Record<TeamTab, string> = { members: "Members", invitations: "Invitations", roles: "Roles" };

/**
 * Members, invitations and roles as three tabs. The open tab is kept in the
 * URL (`?tab=roles`) so a link or a reload lands in the same place.
 */
export function TeamView({ initialTab, members, invitations, roles, viewer, seats, catalogue, timezone, nowIso }: TeamViewProps) {
  const [tab, setTab] = useState<TeamTab>(initialTab);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const counts: Record<TeamTab, number> = { members: members.length, invitations: invitations.length, roles: roles.length };

  function select(next: TeamTab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "members") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = TEAM_TABS.indexOf(tab);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % TEAM_TABS.length;
    if (event.key === "ArrowLeft") next = (index - 1 + TEAM_TABS.length) % TEAM_TABS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = TEAM_TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    select(TEAM_TABS[next]!);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      <div role="tablist" aria-label="Team" className="tabs-list no-scrollbar mb-5 max-w-full justify-start overflow-x-auto" onKeyDown={onKeyDown}>
        {TEAM_TABS.map((item, index) => (
          <button
            key={item}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={`team-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls="team-panel"
            tabIndex={tab === item ? 0 : -1}
            className="tabs-trigger"
            onClick={() => select(item)}
          >
            {TAB_LABELS[item]}
            <span className="rounded-full bg-muted-foreground/15 px-1.5 text-xs">{counts[item]}</span>
          </button>
        ))}
      </div>

      <div id="team-panel" role="tabpanel" aria-labelledby={`team-tab-${tab}`}>
        <SwapIn key={tab}>
          {tab === "members" ? (
            <MembersSection members={members} roles={roles} viewer={viewer} timezone={timezone} />
          ) : tab === "invitations" ? (
            <InvitationsSection invitations={invitations} roles={roles} viewer={viewer} seats={seats} nowIso={nowIso} />
          ) : (
            <RolesSection roles={roles} viewer={viewer} catalogue={catalogue} />
          )}
        </SwapIn>
      </div>
    </>
  );
}
