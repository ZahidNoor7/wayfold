import { MailCheck, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AcceptInvitationButton } from "@/components/auth/accept-invitation";
import { AuthCard, AuthCardSkeleton, TEXT_LINK } from "@/components/auth/auth-card";
import { firstParam, type SearchParams } from "@/components/auth/params";
import { withNext } from "@/components/auth/safe-next";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getSession } from "@/server/auth/guards";
import { normaliseEmail } from "@/server/auth/service";
import { findInvitationByToken, type InvitationLookup } from "@/server/platform/invitations";

export const metadata: Metadata = { title: "Workspace invitation" };

export default function AcceptInvitationPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

const EXPIRY = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });

function Summary({ invitation }: { invitation: InvitationLookup }) {
  const rows = [
    { label: "Workspace", value: invitation.tenantName },
    { label: "Your role", value: invitation.roleName },
    { label: "Invited address", value: invitation.email },
    { label: "Valid until", value: EXPIRY.format(invitation.expiresAt) },
  ];
  return (
    <dl className="mb-6 divide-y rounded-lg border bg-muted/40 text-left text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 px-4 py-3">
          <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words text-right font-semibold">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const token = firstParam((await searchParams).token);
  const invitation = token ? await findInvitationByToken(token) : null;

  if (!token || !invitation) {
    return (
      <AuthCard
        mark={<TriangleAlert aria-hidden="true" />}
        title="This invitation is no longer valid"
        description="It may have expired, been withdrawn, or already been used. Ask the person who invited you to send a new one."
        footer={
          <>
            Already a member?{" "}
            <Link href="/login" className={TEXT_LINK}>
              Sign in
            </Link>
          </>
        }
      />
    );
  }

  const here = `/invitations/accept?token=${encodeURIComponent(token)}`;
  const session = await getSession();
  const title = `Join ${invitation.tenantName}`;

  if (!session) {
    return (
      <AuthCard mark={<MailCheck aria-hidden="true" />} title={title} description="You have been invited to this workspace on Wayfold.">
        <Summary invitation={invitation} />
        <div className="flex flex-col gap-3">
          <Link href={withNext("/login", here)} className="btn btn-default btn-lg w-full">
            Sign in to accept
          </Link>
          <Link href={withNext("/register", here)} className="btn btn-outline btn-lg w-full">
            Create an account
          </Link>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">Use the invited address either way: only that account can accept.</p>
      </AuthCard>
    );
  }

  if (normaliseEmail(session.user.email) !== normaliseEmail(invitation.email)) {
    return (
      <AuthCard
        mark={<TriangleAlert aria-hidden="true" />}
        title="This invitation is for another address"
        description={
          <>
            You are signed in as <strong className="break-all font-semibold text-foreground">{session.user.email}</strong>, but the invitation was sent to{" "}
            <strong className="break-all font-semibold text-foreground">{invitation.email}</strong>.
          </>
        }
      >
        <Summary invitation={invitation} />
        <div className="flex flex-col gap-3">
          <SignOutButton className="btn btn-default btn-lg w-full" next={here}>
            Sign out and switch account
          </SignOutButton>
          <Link href="/workspace" className="btn btn-ghost w-full">
            Stay signed in
          </Link>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          After signing out you will come back here once you sign in as the invited address.
        </p>
      </AuthCard>
    );
  }

  if (!session.user.emailVerified) {
    return (
      <AuthCard
        mark={<MailCheck aria-hidden="true" />}
        title="Confirm your e-mail first"
        description="An invitation can only be accepted by a confirmed address. Confirm yours, then open the invitation link again."
      >
        <Summary invitation={invitation} />
        <Link href="/verify-email" className="btn btn-default btn-lg w-full">
          Confirm my e-mail
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      mark={<MailCheck aria-hidden="true" />}
      title={title}
      description={
        <>
          Accepting adds this workspace to your account, <strong className="break-all font-semibold text-foreground">{session.user.email}</strong>.
        </>
      }
    >
      <Summary invitation={invitation} />
      <AcceptInvitationButton token={token} workspaceName={invitation.tenantName} />
    </AuthCard>
  );
}
