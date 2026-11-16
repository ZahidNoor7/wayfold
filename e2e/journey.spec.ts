import { expect, test, type Page } from "@playwright/test";
import { APP, createWorkspace, newAccount, register, signIn, storefront } from "./support";

/**
 * The core journey, in order, sharing state between steps: a business signs
 * up, sets up its workspace, publishes a tour, a guest books it on the
 * business's own website, and the business confirms it.
 */
test.describe.configure({ mode: "serial" });

// One browser page for the owner across the whole journey, signed in once:
// signing in per step would (correctly) trip the login rate limit.
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
});

const owner = newAccount("alpha");
const business = `Silk Road Walks ${Date.now().toString(36)}`;
let slug = "";

test("a business owner registers, verifies their e-mail and signs in", async () => {
  await register(page, owner);
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/workspaces/);
});

test("they create a workspace and finish onboarding", async () => {
  
  slug = await createWorkspace(page, business);
  expect(slug).toMatch(/^silk-road-walks/);

  // Profile saved with its defaults, the look skipped, then finish.
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("button", { name: /skip for now|continue/i }).first().click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByRole("button", { name: "Finish and open workspace" }).click();
  await page.waitForURL(`${APP}/workspace`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace" }).first()).toBeVisible();
});

const tourTitle = "Old City at Dusk";

let tourId = "";

test("they create a private tour and publish it", async () => {
  await page.goto(`${APP}/workspace/tours/new`);
  await page.getByLabel("Title").fill(tourTitle);
  await page.getByLabel("Summary").fill("A slow evening walk through the walled old city, ending with tea on a rooftop.");
  await page.getByText("Private tour", { exact: true }).click();
  await page.getByLabel("Duration shown to guests").fill("3 hours");
  await page.getByLabel(/^Adult price/).fill("85");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(/\/workspace\/tours\/[0-9a-f-]{36}$/);
  tourId = page.url().split("/").at(-1)!;

  await page.getByRole("button", { name: "Publish tour" }).click();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
});

let reference = "";
const guestEmail = `guest-${Date.now().toString(36)}@example.test`;

test("a guest finds the tour on the business's own website and sends a booking request", async ({ browser }) => {
  // A separate browser profile: the guest shares nothing with the owner.
  const guestContext = await browser.newContext();
  const page = await guestContext.newPage();
  await page.goto(storefront(slug));
  await expect(page).toHaveTitle(new RegExp(business));
  await page.getByRole("link", { name: new RegExp(tourTitle) }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: tourTitle })).toBeVisible();

  const booking = page.getByRole("complementary", { name: "Book this experience" });
  await booking.getByRole("button", { name: /, available$/ }).first().click();
  await booking.getByRole("link", { name: "Request to book" }).click();
  // The form moves the prefilled choices into its own state and tidies the URL.
  await page.waitForURL(/\/book(\?|$)/);
  await expect(page.getByRole("heading", { name: /choose your tour, date/i })).toBeVisible();

  await page.getByRole("button", { name: "Continue to your details" }).click();
  await page.getByLabel("Full name").fill("Eleanor Whitfield");
  await page.getByLabel("Email address").fill(guestEmail);
  await page.getByLabel("Country calling code").selectOption("+44");
  await page.getByLabel("Phone number").fill("7700 900821");
  // The radio is visually hidden inside its chip; people click the chip.
  await page.locator("label.chip", { hasText: /^Email$/ }).click();
  await expect(page.getByRole("radio", { name: "Email" })).toBeChecked();
  await page.getByRole("button", { name: "Continue to review" }).click();
  await page.getByRole("checkbox", { name: /booking request/i }).check();
  await page.getByRole("button", { name: "Send booking request" }).click();

  await expect(page.getByText("Request received")).toBeVisible();
  reference = (await page.getByText(/^[A-Z]{2,4}-[A-Z]{3}-\d{4}$/).first().textContent())?.trim() ?? "";
  expect(reference).toMatch(/^[A-Z]{2,4}-OLD-\d{4}$/);
  await guestContext.close();
});

let bookingId = "";

test("the business sees the request and confirms it", async () => {
  await page.goto(`${APP}/workspace/bookings`);
  await page.getByText(reference).first().click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Eleanor Whitfield").first()).toBeVisible();
  await panel.getByRole("button", { name: /^confirm( booking)?$/i }).click();
  await expect(panel.getByText(/confirmed/i).first()).toBeVisible();
  bookingId = new URL(page.url()).searchParams.get("booking") ?? "";
  expect(bookingId).toMatch(/^[0-9a-f-]{36}$/);
});

test("another business cannot reach the first one's records, even with their ids", async ({ browser }) => {
  const rivalContext = await browser.newContext();
  const rival = await rivalContext.newPage();
  const rivalOwner = newAccount("rival");
  await register(rival, rivalOwner);
  await signIn(rival, rivalOwner);
  const rivalSlug = await createWorkspace(rival, `Rival Tours ${Date.now().toString(36)}`);
  await rival.goto(`${APP}/workspace`);

  // The first business's tour, by id, in the rival's editor: not found.
  const tourResponse = await rival.goto(`${APP}/workspace/tours/${tourId}`);
  await expect(rival.getByText(/not on the map|not found/i).first()).toBeVisible();
  expect([200, 404]).toContain(tourResponse?.status());
  await expect(rival.getByText(tourTitle)).toHaveCount(0);

  // The first business's booking, by id, in the rival's bookings panel: nothing opens.
  await rival.goto(`${APP}/workspace/bookings?booking=${bookingId}`);
  await expect(rival.getByText(reference)).toHaveCount(0);
  await expect(rival.getByText("Eleanor Whitfield")).toHaveCount(0);

  // The export cannot be pointed at another workspace either.
  const csv = await rival.request.get(`${APP}/workspace/bookings/export?tenantId=${tourId}`);
  expect(await csv.text()).not.toContain(reference);

  // The rival's website does not serve the first business's tour.
  await rival.goto(`${storefront(rivalSlug)}/experiences/old-city-at-dusk`);
  await expect(rival.getByText(tourTitle)).toHaveCount(0);

  await rivalContext.close();
});


test("integration secrets are stored without ever being sent back to the browser", async () => {
  const secret = `smtp-pass-${Date.now().toString(36)}-do-not-leak`;
  await page.goto(`${APP}/workspace/settings/integrations`);
  await page.getByRole("button", { name: /^Connect SMTP/ }).first().click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("SMTP server").fill("smtp.example.com");
  await panel.getByLabel("Port").fill("587");
  await panel.getByRole("switch", { name: "Require STARTTLS" }).click();
  await panel.getByRole("textbox", { name: "Username" }).fill("bookings@example.com");
  await panel.getByRole("textbox", { name: "Password" }).fill(secret);
  await panel.getByLabel("Sender name").fill("Silk Road Walks");
  await panel.getByLabel("Sender address").fill("bookings@example.com");

  // Watch every response the browser receives while saving and reloading.
  const bodies: string[] = [];
  page.on("response", async (response) => {
    try {
      bodies.push(await response.text());
    } catch {
      // Redirects and aborted requests have no body.
    }
  });
  await panel.getByRole("button", { name: /^Connect SMTP/ }).click();
  await expect(page.getByText("Not tested yet").first()).toBeVisible();
  await page.reload();

  // Editing shows only a masked hint; the secret inputs start empty.
  await page.getByRole("button", { name: /^Edit SMTP/ }).click();
  const edit = page.getByRole("dialog");
  await expect(edit.getByRole("textbox", { name: "Password" })).toHaveValue("");
  await expect(edit.getByText(/••••/).first()).toBeVisible();

  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) expect(body).not.toContain(secret);
  expect(await page.content()).not.toContain(secret);
});

test("the platform owner sees both workspaces in the back office", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, { email: "owner@wayfold.test", password: "e2e-platform-owner-1" });
  await admin.goto(`${APP}/platform/tenants`);
  await expect(admin.getByText(business).first()).toBeVisible();
  await expect(admin.getByText(/Rival Tours/).first()).toBeVisible();
  await adminContext.close();
});

test("a business owner cannot open the platform back office", async () => {
  await page.goto(`${APP}/platform`);
  await expect(page).not.toHaveURL(/\/platform/);
});
