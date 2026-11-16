import { expect, test } from "@playwright/test";
import {
  APP,
  createWorkspace,
  expectNoHorizontalScroll,
  finishOnboarding,
  newAccount,
  publishPrivateTour,
  register,
  signIn,
  storefront,
} from "./support";

/** Phone-width checks (Pixel 7 profile, 412 px): the design's mobile behaviour. */
test.describe.configure({ mode: "serial" });

const owner = newAccount("phone");
const tour = "Harbour Lights Walk";
let slug = "";

test("the workspace works on a phone: top bar, slide-out menu, no sideways scroll", async ({ page }) => {
  await register(page, owner);
  await signIn(page, owner);
  slug = await createWorkspace(page, `Harbour Guides ${Date.now().toString(36)}`);
  await finishOnboarding(page);
  await expectNoHorizontalScroll(page, "workspace overview");

  await page.getByRole("button", { name: "Open navigation" }).click();
  const menu = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(menu.getByRole("link", { name: "Bookings" })).toBeVisible();
  await menu.getByRole("link", { name: "Tours" }).click();
  await page.waitForURL(`${APP}/workspace/tours`);
  await expect(menu).toBeHidden();
  await expectNoHorizontalScroll(page, "tours list");

  await publishPrivateTour(page, tour);
  await expectNoHorizontalScroll(page, "tour editor");
});

test("the storefront works on a phone: menu sheet, tour page, booking form", async ({ browser }) => {
  const context = await browser.newContext({ ...test.info().project.use });
  const page = await context.newPage();

  await page.goto(storefront(slug));
  await expectNoHorizontalScroll(page, "storefront home");
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByRole("link", { name: "Experiences" })).toBeVisible();
  await menu.getByRole("link", { name: "Experiences" }).click();
  await page.waitForURL(/\/experiences$/);
  await expectNoHorizontalScroll(page, "experiences");

  await page.getByRole("link", { name: new RegExp(tour) }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: tour })).toBeVisible();
  await expectNoHorizontalScroll(page, "tour detail");

  await page.goto(`${storefront(slug)}/book`);
  await expect(page.getByRole("heading", { name: /choose your tour, date/i })).toBeVisible();
  await expectNoHorizontalScroll(page, "booking form");

  for (const path of ["/about", "/journey", "/reviews", "/contact", "/offers"]) {
    await page.goto(`${storefront(slug)}${path}`);
    await expectNoHorizontalScroll(page, path);
  }
  await context.close();
});
