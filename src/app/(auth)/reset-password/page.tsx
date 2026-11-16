import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard, AuthCardSkeleton } from "@/components/auth/auth-card";
import { firstParam, type SearchParams } from "@/components/auth/params";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const token = firstParam((await searchParams).token);

  if (!token || token.length > 200) {
    return (
      <AuthCard
        mark={<TriangleAlert aria-hidden="true" />}
        title="This link is incomplete"
        description="Open the link from your e-mail again, or ask for a new one. Reset links work once and expire after 1 hour."
      >
        <Link href="/forgot-password" className="btn btn-default btn-lg w-full">
          Send a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" description="Pick a password you do not use anywhere else.">
      <ResetPasswordForm token={token} minPasswordLength={PASSWORD_MIN_LENGTH} />
    </AuthCard>
  );
}
