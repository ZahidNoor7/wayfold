import { Suspense, type ReactNode } from "react";
import { PlatformChrome } from "@/components/platform/chrome";
import { PageSkeleton } from "@/components/workspace/page-header";
import { platformGuard } from "../_lib/guard";

async function Shell({ children }: { children: ReactNode }) {
  const { admin } = await platformGuard();
  return (
    <PlatformChrome user={{ name: admin.session.user.name, email: admin.session.user.email }} role={admin.role}>
      {children}
    </PlatformChrome>
  );
}

export default function PlatformConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-muted/40 p-5 sm:p-8">
          <PageSkeleton />
        </div>
      }
    >
      <Shell>{children}</Shell>
    </Suspense>
  );
}
