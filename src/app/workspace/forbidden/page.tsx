import Link from "next/link";
import { EmptyState } from "@/components/workspace/page-header";

export const metadata = { title: "No access" };

export default function ForbiddenPage() {
  return (
    <EmptyState
      title="This area is not part of your role"
      description="Your role in this workspace does not include this section. Ask a workspace owner or administrator if you need access."
      action={
        <Link href="/workspace" className="btn btn-default">
          Back to overview
        </Link>
      }
    />
  );
}
