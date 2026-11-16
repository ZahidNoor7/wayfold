import { Suspense } from "react";
import { PageSkeleton } from "@/components/workspace/page-header";
import { TourEditor } from "@/components/workspace/tours/tour-editor";
import { emptyTourValues } from "@/components/workspace/tours/tour-form-model";
import { todayIn } from "@/lib/dates";
import { requireWorkspace } from "@/server/auth/guards";
import { inWorkspace } from "@/server/auth/workspace";
import { editorAccess, loadEditorContext } from "../editor-data";

export const metadata = { title: "New tour" };

export default function NewTourPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const workspace = await requireWorkspace("tours.manage");
  const context = await inWorkspace(workspace, loadEditorContext);

  return (
    <TourEditor
      tour={null}
      initial={emptyTourValues()}
      {...editorAccess(workspace)}
      {...context}
      departures={[]}
      departureDays={{}}
      blocks={[]}
      today={todayIn(workspace.tenant.timezone)}
    />
  );
}
