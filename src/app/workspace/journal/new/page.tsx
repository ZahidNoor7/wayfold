import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { storefrontOrigin } from "@/components/workspace/content/storefront-origin";
import { JournalForm } from "@/components/workspace/content/journal/journal-form";
import { loadJournalOptions } from "@/components/workspace/content/journal/journal-options";
import { PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { requireWorkspace } from "@/server/auth/guards";
import { can, inWorkspace } from "@/server/auth/workspace";

export const metadata = { title: "New journal entry" };

export default function NewJournalEntryPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const workspace = await requireWorkspace("content.manage");
  const options = await inWorkspace(workspace, loadJournalOptions);

  return (
    <>
      <Link href="/workspace/journal" className="btn btn-ghost btn-sm -ml-3 mb-2">
        <ArrowLeft aria-hidden="true" />
        Journal
      </Link>
      <PageHeader title="New journal entry" description="New entries are saved as drafts until you switch on Published." />
      <JournalForm
        entry={null}
        destinations={options.destinations}
        tours={options.tours}
        origin={storefrontOrigin(workspace)}
        canUpload={can(workspace, "media.manage")}
      />
    </>
  );
}
