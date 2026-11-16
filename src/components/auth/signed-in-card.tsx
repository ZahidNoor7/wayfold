import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { AuthCard } from "./auth-card";
import { SignOutButton } from "./sign-out-button";

/**
 * Shown on sign-in and registration pages to someone who already has a
 * session, instead of the form. Also what those pages become for a moment
 * right after signing in, before the browser moves on.
 */
export function SignedInCard({ email, next }: { email: string; next: string | null }) {
  return (
    <AuthCard
      mark={<CircleCheck aria-hidden="true" />}
      title="You are signed in"
      description={
        <>
          Signed in as <strong className="break-all font-semibold text-foreground">{email}</strong>.
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Link href={next ?? "/workspace"} className="btn btn-default btn-lg w-full">
          Continue
        </Link>
        <SignOutButton className="btn btn-ghost w-full" next={next ?? undefined}>
          Sign out and use another account
        </SignOutButton>
      </div>
    </AuthCard>
  );
}
