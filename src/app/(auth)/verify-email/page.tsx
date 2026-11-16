import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/components/auth/auth-card";
import { firstParam, type SearchParams } from "@/components/auth/params";
import { ConfirmEmail, ResendVerification } from "@/components/auth/verify-email";
import { getSession, requireUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Confirm your e-mail" };

export default function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const token = firstParam((await searchParams).token);

  if (token) {
    const session = await getSession();
    return <ConfirmEmail token={token} viewer={session ? { email: session.user.email, verified: session.user.emailVerified } : null} />;
  }

  // No link: this is the waiting room for a signed-in, unconfirmed account.
  const session = await requireUser();
  if (session.user.emailVerified) redirect("/workspace");
  return <ResendVerification email={session.user.email} />;
}
