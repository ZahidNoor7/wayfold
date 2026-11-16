"use client";

import { CircleCheck, MailCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { resendVerificationAction, verifyEmailAction } from "@/app/(auth)/actions";
import { FormError } from "@/components/form";
import { Spinner } from "@/components/overlays";
import { useAction } from "@/hooks/use-action";
import { AuthCard } from "./auth-card";
import { loginPathWithNotice } from "./login-notices";
import { SignOutButton } from "./sign-out-button";

type State = { step: "working" } | { step: "done" } | { step: "failed"; message: string };

interface ConfirmEmailProps {
  token: string;
  /** Null when nobody is signed in. */
  viewer: { email: string; verified: boolean } | null;
}

/**
 * Confirms the address as soon as the page is interactive. The link is
 * single-use, so it is spent by this page rather than by whatever fetched the
 * URL first (mail scanners and link previews do not run scripts).
 */
export function ConfirmEmail({ token, viewer }: ConfirmEmailProps) {
  const [state, setState] = useState<State>({ step: "working" });
  const started = useRef(false);

  useEffect(() => {
    // Strict mode runs effects twice; the token would be refused the second time.
    if (started.current) return;
    started.current = true;
    verifyEmailAction({ token })
      .then((result) => setState(result.ok ? { step: "done" } : { step: "failed", message: result.error }))
      .catch(() => setState({ step: "failed", message: "We could not reach the server. Check your connection and reload this page." }));
  }, [token]);

  if (state.step === "working") {
    return (
      <AuthCard title="Confirming your e-mail" description="This takes a moment.">
        <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
          <Spinner className="size-5 text-primary" />
          Checking your link…
        </div>
      </AuthCard>
    );
  }

  if (state.step === "done") {
    return (
      <AuthCard
        announce
        mark={<CircleCheck aria-hidden="true" />}
        title="E-mail confirmed"
        description={viewer ? "Your address is confirmed. You can set up your workspace now." : "Your address is confirmed. Sign in to set up your workspace."}
      >
        <Link href={viewer ? "/workspace" : loginPathWithNotice("email-verified")} className="btn btn-default btn-lg w-full">
          {viewer ? "Continue" : "Continue to sign in"}
        </Link>
      </AuthCard>
    );
  }

  if (viewer?.verified) {
    return (
      <AuthCard mark={<CircleCheck aria-hidden="true" />} title="Already confirmed" description="This link has been used, and your address is confirmed.">
        <Link href="/workspace" className="btn btn-default btn-lg w-full">
          Continue
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard mark={<TriangleAlert aria-hidden="true" />} title="This link did not work" description={state.message}>
      {viewer ? (
        <ResendVerification email={viewer.email} compact />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            If you used the link before, your address may already be confirmed. Sign in to check, or to have a new link sent.
          </p>
          <Link href="/login" className="btn btn-default btn-lg w-full">
            Sign in
          </Link>
        </div>
      )}
    </AuthCard>
  );
}

interface ResendVerificationProps {
  email: string;
  /** Rendered inside another card: no heading of its own. */
  compact?: boolean;
}

/** For a signed-in, unverified account: explain, and send the link again. */
export function ResendVerification({ email, compact }: ResendVerificationProps) {
  const { run, pending, error } = useAction(resendVerificationAction, { toastError: false });
  const [sent, setSent] = useState(false);

  const body = (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      {sent ? (
        <p role="status" className="alert text-left">
          A new link is on its way to <strong className="break-all font-semibold">{email}</strong>. Earlier links no longer work.
        </p>
      ) : null}
      <button
        type="button"
        className="btn btn-default btn-lg w-full"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={async () => {
          setSent(false);
          const result = await run({});
          if (result.ok) setSent(true);
        }}
      >
        {pending ? <Spinner /> : null}
        {sent ? "Send again" : "Resend e-mail"}
      </button>
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <span>Wrong address?</span>
        <SignOutButton className="btn btn-link px-0">Sign out</SignOutButton>
      </div>
    </div>
  );

  if (compact) return body;

  return (
    <AuthCard
      mark={<MailCheck aria-hidden="true" />}
      title="Confirm your e-mail"
      description={
        <>
          We sent a confirmation link to <strong className="break-all font-semibold text-foreground">{email}</strong>. Open it to finish setting up your account.
          The link works once and expires in 24 hours.
        </>
      }
    >
      {body}
    </AuthCard>
  );
}
