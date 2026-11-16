import type { Metadata } from "next";
import { Suspense } from "react";
import { ChangePasswordForm, ProfileNameForm, SignOutOthers } from "@/components/auth/account-forms";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { requireWorkspace } from "@/server/auth/guards";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";

export const metadata: Metadata = { title: "Your account" };

export default function AccountPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const workspace = await requireWorkspace();
  const { user } = workspace;

  return (
    <>
      <PageHeader title="Your account" description="Your name, your password and where you are signed in. These follow you across every workspace." />

      {workspace.support ? (
        <p className="alert alert-warning max-w-2xl">Account settings are not available during a support session. End the session to manage your own account.</p>
      ) : (
        <div className="flex max-w-2xl flex-col gap-6">
          <section aria-labelledby="account-profile" className="card">
            <div className="card-header">
              <h2 id="account-profile" className="card-title">
                Profile
              </h2>
              <p className="card-description">How you appear to the people you work with.</p>
            </div>
            <div className="card-content">
              <ProfileNameForm name={user.name} email={user.email} />
            </div>
          </section>

          <section aria-labelledby="account-password" className="card">
            <div className="card-header">
              <h2 id="account-password" className="card-title">
                Password
              </h2>
              <p className="card-description">Changing it signs you out on every other device.</p>
            </div>
            <div className="card-content">
              <ChangePasswordForm email={user.email} minPasswordLength={PASSWORD_MIN_LENGTH} />
            </div>
          </section>

          <section aria-labelledby="account-sessions" className="card">
            <div className="card-header">
              <h2 id="account-sessions" className="card-title">
                Sessions
              </h2>
              <p className="card-description">Signed in somewhere you no longer use, or on a shared computer? End those sessions here.</p>
            </div>
            <div className="card-content">
              <SignOutOthers>
                <SignOutButton className="btn btn-ghost">Sign out of this device</SignOutButton>
              </SignOutOthers>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
