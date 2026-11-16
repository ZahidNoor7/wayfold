import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { formatDateTime } from "@/lib/platform-display";
import { getSession, getWorkspace } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Support session" };

/**
 * Where a support session lands when it reaches the back office: either the
 * admin navigated here mid-session, or the workspace sent them back because
 * the approval ended. A support session has no platform powers, so this page
 * sits outside the console and offers the one thing that is possible: end it.
 */
export default function SupportSessionPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-muted/40" aria-busy="true" />}>
      <SupportSession />
    </Suspense>
  );
}

async function SupportSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  // An ordinary session has nothing to end here.
  if (!session.supportGrantId) redirect("/platform/support");

  const resolution = await getWorkspace();
  const workspace = resolution?.ok ? resolution.workspace : null;
  const live = workspace?.support ?? null;

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-muted/40 p-5">
      <div className="card w-full max-w-lg p-6 sm:p-8">
        <p className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-semibold text-primary">Wayfold</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-eyebrow">Platform</span>
        </p>
        <ShieldAlert aria-hidden="true" className="mt-6 size-8 text-primary" />
        <h1 className="mt-3 font-display text-3xl font-semibold text-primary">{live ? "You are in a support session" : "This support session has ended"}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {live && workspace
            ? `You are signed in to ${workspace.tenant.name} with view-only support access until ${formatDateTime(live.expiresAt)}. The platform back office is not available during a support session.`
            : "The workspace's approval ran out or was withdrawn, or the workspace is no longer available, so it is closed to you."}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Ending the session signs you out. Sign in again to return to the platform back office.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <form action="/platform/support/end" method="post" className="contents">
            <button type="submit" className="btn btn-default">
              End session and sign in again
            </button>
          </form>
          {live ? (
            <Link href="/workspace" className="btn btn-outline">
              Return to the workspace
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  );
}
