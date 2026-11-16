import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/server/errors";
import { listMediaCredits, updateMedia } from "@/server/media";
import { loadStorefrontShell } from "@/server/storefront/shell";
import { createTenant } from "../../helpers/fixtures";
import { connectCloudinary, FakeCloudinary, inTenant, newAccount, uploadFile } from "./helpers";

vi.mock("@/server/platform/managed-storage", () => ({ getManagedStorage: vi.fn(async () => null) }));

let cloud: FakeCloudinary;
beforeEach(() => {
  cloud = new FakeCloudinary().install();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function connectedTenant() {
  const tenant = await createTenant();
  cloud.addAccount(await connectCloudinary(tenant, newAccount()));
  return tenant;
}

describe("photo credits", () => {
  it("stores a credit and link, lists only credited photos, and flags the storefront", async () => {
    const tenant = await connectedTenant();
    const credited = await uploadFile(tenant, cloud);
    await uploadFile(tenant, cloud);

    expect(await inTenant(tenant, listMediaCredits)).toEqual([]);
    const shellBefore = await inTenant(tenant, (scope) => loadStorefrontShell(scope, { today: "2027-01-01", social: {} }));
    expect(shellBefore.hasPhotoCredits).toBe(false);

    const updated = await inTenant(tenant, (scope) =>
      updateMedia(scope, credited.id, { credit: "Photo: A. Author, CC BY-SA 4.0", creditUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg" }),
    );
    expect(updated).toMatchObject({ credit: "Photo: A. Author, CC BY-SA 4.0", creditUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg" });

    const credits = await inTenant(tenant, listMediaCredits);
    expect(credits).toEqual([{ id: credited.id, url: credited.url, alt: credited.alt, credit: "Photo: A. Author, CC BY-SA 4.0", creditUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg" }]);
    const shellAfter = await inTenant(tenant, (scope) => loadStorefrontShell(scope, { today: "2027-01-01", social: {} }));
    expect(shellAfter.hasPhotoCredits).toBe(true);

    // Clearing the credit removes it from the list.
    await inTenant(tenant, (scope) => updateMedia(scope, credited.id, { credit: "" }));
    expect(await inTenant(tenant, listMediaCredits)).toEqual([]);
  });

  it("refuses a credit link that is not a web address", async () => {
    const tenant = await connectedTenant();
    const asset = await uploadFile(tenant, cloud);
    await expect(inTenant(tenant, (scope) => updateMedia(scope, asset.id, { creditUrl: "javascript:alert(1)" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(inTenant(tenant, (scope) => updateMedia(scope, asset.id, { credit: "x".repeat(301) }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("never lists another business's credits", async () => {
    const a = await connectedTenant();
    const b = await connectedTenant();
    const asset = await uploadFile(a, cloud);
    await inTenant(a, (scope) => updateMedia(scope, asset.id, { credit: "Photo: A. Author, CC BY 4.0" }));

    expect(await inTenant(b, listMediaCredits)).toEqual([]);
    const shell = await inTenant(b, (scope) => loadStorefrontShell(scope, { today: "2027-01-01", social: {} }));
    expect(shell.hasPhotoCredits).toBe(false);
  });
});
