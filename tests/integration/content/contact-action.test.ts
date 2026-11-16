import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendInquiryAction } from "@/app/s/[site]/contact/actions";
import { withTenant } from "@/server/db/context";
import { inquiries } from "@/server/db/schema";
import { MIN_HUMAN_FILL_MS } from "@/lib/spam-trap";
import { createTenant, type TenantFixture } from "../../helpers/fixtures";
import { fakeRequest } from "../foundation/fake-request";
import { auditFor } from "../foundation/support";

// The storefront action reads the Host header and schedules e-mail after the
// response; both need a live Next.js request, so they are stood in for here.
vi.mock("next/headers", () => import("../foundation/fake-request"));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => undefined,
  connection: async () => undefined,
}));

let ipCounter = 0;
/** A fresh visitor address per test, so the per-visitor rate limit never interferes. */
function visit(t: TenantFixture) {
  ipCounter += 1;
  fakeRequest.setHeaders({ host: `${t.slug}.wayfold.test`, "x-real-ip": `198.51.100.${ipCounter}` });
}

const message = {
  name: "Anna Visitor",
  email: "anna@example.com",
  message: "Hello, we would like to book a tour for two in May.",
};

function storedFor(tenantId: string) {
  return withTenant(tenantId, ({ tx }) => tx.select().from(inquiries).where(eq(inquiries.tenantId, tenantId)));
}

beforeEach(() => {
  fakeRequest.reset();
});

describe("sendInquiryAction", () => {
  it("stores an ordinary message", async () => {
    const t = await createTenant();
    visit(t);
    expect(await sendInquiryAction({ ...message, topic: "", elapsedMs: 40_000 })).toEqual({ ok: true, data: { sent: true } });
    expect(await storedFor(t.tenantId)).toHaveLength(1);
  });

  it("stores a message whose hidden field was autofilled by a person's browser", async () => {
    const t = await createTenant();
    visit(t);
    expect(await sendInquiryAction({ ...message, topic: "Anna Visitor", elapsedMs: MIN_HUMAN_FILL_MS + 5_000 })).toEqual({ ok: true, data: { sent: true } });
    const [stored] = await storedFor(t.tenantId);
    expect(stored).toMatchObject({ name: "Anna Visitor", email: "anna@example.com", status: "new" });
    expect((await auditFor(t.tenantId)).map((entry) => entry.action)).not.toContain("inquiry.blocked_as_spam");
  });

  it("drops a script's submission but answers the same, and records the drop", async () => {
    const t = await createTenant();
    visit(t);
    expect(await sendInquiryAction({ ...message, topic: "cheap pills", elapsedMs: 120 })).toEqual({ ok: true, data: { sent: true } });
    visit(t);
    expect(await sendInquiryAction({ ...message, topic: "cheap pills" })).toEqual({ ok: true, data: { sent: true } });

    expect(await storedFor(t.tenantId)).toHaveLength(0);
    const blocked = (await auditFor(t.tenantId)).filter((entry) => entry.action === "inquiry.blocked_as_spam");
    expect(blocked.map((entry) => entry.metadata)).toEqual([{ elapsedMs: 120 }, { elapsedMs: null }]);
    expect(blocked[0]!.ip).toMatch(/^198\.51\.100\./);
  });

  it("still validates the message itself", async () => {
    const t = await createTenant();
    visit(t);
    const result = await sendInquiryAction({ ...message, email: "not-an-email", elapsedMs: 40_000 });
    expect(result.ok).toBe(false);
    expect(await storedFor(t.tenantId)).toHaveLength(0);
  });
});
