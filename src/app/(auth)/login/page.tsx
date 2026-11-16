import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard, AuthCardSkeleton, Notice, TEXT_LINK } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { loginNotice } from "@/components/auth/login-notices";
import type { SearchParams } from "@/components/auth/params";
import { invitationTokenFrom, safeNextPath, withNext } from "@/components/auth/safe-next";
import { SignedInCard } from "@/components/auth/signed-in-card";
import { getSession } from "@/server/auth/guards";
import { findInvitationByToken } from "@/server/platform/invitations";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  // An allow-list: the parameter picks a fixed sentence and is never shown itself.
  const notice = loginNotice(params.notice);

  const session = await getSession();
  if (session) return <SignedInCard email={session.user.email} next={next} />;

  // Arriving from an invitation: say so, and start with the invited address.
  const invitationToken = invitationTokenFrom(next);
  const invitation = invitationToken ? await findInvitationByToken(invitationToken) : null;

  return (
    <AuthCard
      title="Sign in"
      description={invitation ? `Sign in to join ${invitation.tenantName}.` : "Welcome back. Sign in to your workspace."}
      footer={
        <>
          New to Wayfold?{" "}
          <Link href={withNext("/register", next)} className={TEXT_LINK}>
            Create an account
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}
        {invitation ? (
          <Notice>
            You were invited as <strong className="font-semibold">{invitation.roleName}</strong>. Sign in with{" "}
            <strong className="break-all font-semibold">{invitation.email}</strong> to accept.
          </Notice>
        ) : null}
        <LoginForm next={next} defaultEmail={invitation?.email} />
      </div>
    </AuthCard>
  );
}
