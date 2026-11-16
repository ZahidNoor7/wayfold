"use client";

import { useState } from "react";
import { openWorkspaceAction } from "@/app/workspaces/actions";
import { leaveTo } from "@/components/auth/clear-caches";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";

export interface WorkspaceCard {
  tenantId: string;
  name: string;
  address: string;
  roleName: string;
  status: "active" | "suspended";
  current: boolean;
}

/** The user's workspaces as cards. Opening one switches the session to it. */
export function WorkspaceList({ workspaces }: { workspaces: WorkspaceCard[] }) {
  const { run } = useAction(openWorkspaceAction);
  const [opening, setOpening] = useState<string | null>(null);

  async function open(tenantId: string) {
    if (opening) return;
    setOpening(tenantId);
    const result = await run({ tenantId });
    if (result.ok) {
      // A workspace switch: leave with a full load and empty caches.
      await leaveTo(result.data.redirectTo);
      return;
    }
    setOpening(null);
  }

  return (
    <ul aria-label="Your workspaces" className="grid gap-4 sm:grid-cols-2">
      {workspaces.map((workspace) => {
        const busy = opening === workspace.tenantId;
        return (
          <li key={workspace.tenantId} className="card flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words font-display text-2xl font-semibold leading-tight text-primary">{workspace.name}</h2>
                <p className="mt-1 break-all text-[13px] text-muted-foreground">{workspace.address}</p>
              </div>
              {workspace.status === "suspended" ? (
                <span className="badge badge-cancelled shrink-0">Suspended</span>
              ) : (
                <span className="badge badge-confirmed shrink-0">Active</span>
              )}
            </div>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="min-w-0 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{workspace.roleName || "Member"}</span>
                {workspace.current ? " · last opened" : null}
              </p>
              <button
                type="button"
                className={workspace.status === "suspended" ? "btn btn-outline" : "btn btn-default"}
                disabled={opening !== null}
                aria-busy={busy || undefined}
                onClick={() => open(workspace.tenantId)}
              >
                {busy ? <Spinner /> : null}
                {workspace.status === "suspended" ? "View status" : "Open"}
                <span className="sr-only"> {workspace.name}</span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
