import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardSkeleton, Notice } from "@/components/auth/auth-card";
import type { SearchParams } from "@/components/auth/params";
import { RegisterForm } from "@/components/auth/register-form";
import { marketingUrl } from "@/components/marketing/urls";
import { invitationTokenFrom, safeNextPath } from "@/components/auth/safe-next";
import { SignedInCard } from "@/components/auth/signed-in-card";
import { getSession } from "@/server/auth/guards";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { findInvitationByToken } from "@/server/platform/invitations";

export const metadata: Metadata = { title: "Create your account" };

export default function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(params.next);

  const session = await getSession();
  if (session) return <SignedInCard email={session.user.email} next={next} />;

  const invitationToken = invitationTokenFrom(next);
  const invitation = invitationToken ? await findInvitationByToken(invitationToken) : null;

  return (
    <RegisterForm
      legal={{ terms: marketingUrl("/terms"), privacy: marketingUrl("/privacy") }}
      minPasswordLength={PASSWORD_MIN_LENGTH}
      next={next}
      defaultEmail={invitation?.email}
      invitedTo={invitation?.tenantName ?? null}
      notice={
        invitation ? (
          <Notice>
            You were invited to <strong className="font-semibold">{invitation.tenantName}</strong> as{" "}
            <strong className="font-semibold">{invitation.roleName}</strong>.
          </Notice>
        ) : null
      }
    />
  );
}
