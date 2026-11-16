import { redirect } from "next/navigation";
import { Suspense } from "react";
import { InquiriesBoard, type InquiryItem } from "@/components/workspace/inquiries/inquiries-board";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/workspace/page-header";
import { enumParam, hrefWith, pageCount, parsePage, type SearchParams } from "@/lib/booking-display";
import { requireWorkspace } from "@/server/auth/guards";
import { inWorkspace } from "@/server/auth/workspace";
import { countInquiriesByStatus, INQUIRY_STATUSES, listInquiries } from "@/server/content/inquiries";
import { listIntegrations } from "@/server/integrations";
import { whatsappChatLink } from "@/server/integrations/adapters/whatsapp";

export const metadata = { title: "Enquiries" };

const PAGE_SIZE = 50;

export default function InquiriesPage(props: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const workspace = await requireWorkspace("content.manage");
  const params = await searchParams;
  const status = enumParam(params.status, INQUIRY_STATUSES);
  const page = parsePage(params.page);

  // One transaction is one connection: its queries run one after another.
  const { list, counts, hasMessaging } = await inWorkspace(workspace, async (scope) => {
    const list = await listInquiries(scope, { status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    const counts = await countInquiriesByStatus(scope);
    const integrations = await listIntegrations(scope);
    return {
      list,
      counts,
      hasMessaging: integrations.some((integration) => integration.category === "messaging" && integration.status !== "disabled"),
    };
  });

  // A page past the end (a stale link, or the last row of a page was deleted) lands on the last page.
  const pages = pageCount(list.total, PAGE_SIZE);
  if (list.total > 0 && page > pages) {
    redirect(hrefWith("/workspace/inquiries", { status, page: pages > 1 ? pages : undefined }));
  }

  const header = <PageHeader title="Enquiries" description="Messages sent through your website's contact form." />;

  if (!status && list.total === 0) {
    return (
      <>
        {header}
        <EmptyState
          title="No enquiries yet"
          description="When a visitor sends a message through the contact form on your website, it arrives here. You can read it, reply by e-mail and archive it when it is dealt with."
        />
      </>
    );
  }

  // WhatsApp links are only offered once the workspace has connected a
  // messaging integration, and they are built here, never in the browser.
  const items: InquiryItem[] = list.items.map((inquiry) => ({
    ...inquiry,
    whatsappHref: hasMessaging && inquiry.phone ? whatsappChatLink(inquiry.phone) : null,
  }));

  return (
    <>
      {header}
      <InquiriesBoard
        items={items}
        total={list.total}
        page={page}
        pageSize={PAGE_SIZE}
        status={status ?? null}
        counts={counts}
        nowIso={new Date().toISOString()}
        timezone={workspace.tenant.timezone}
        workspaceName={workspace.tenant.name}
      />
    </>
  );
}
