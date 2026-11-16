import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const PORT = Number(process.env.E2E_PORT ?? "3310");
export const APP = `http://app.localhost:${PORT}`;
export const storefront = (slug: string) => `http://${slug}.localhost:${PORT}`;

const MAIL_FILE = path.resolve(".local/e2e/mail.jsonl");

interface CapturedMail {
  to: string;
  subject: string;
  text: string;
  at: string;
}

/** Messages the platform mailer captured (instead of sending) during this run. */
function mailbox(): CapturedMail[] {
  return readFileSync(MAIL_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedMail);
}

/** Waits for the newest message to `to` whose subject matches, and returns its first link containing `pathPart`. */
export async function linkFromMail(to: string, subject: RegExp, pathPart: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      () => {
        const message = mailbox()
          .filter((mail) => mail.to.toLowerCase() === to.toLowerCase() && subject.test(mail.subject))
          .at(-1);
        link = message?.text.match(new RegExp(`https?://\\S*${pathPart}\\S*`))?.[0];
        return Boolean(link);
      },
      { timeout: 20_000, message: `an e-mail to ${to} matching ${subject}` },
    )
    .toBe(true);
  return link!;
}

export interface Account {
  name: string;
  email: string;
  password: string;
}

export function newAccount(label: string): Account {
  const id = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return { name: `Owner ${label}`, email: `${id}@example.test`, password: `long-enough-${id}` };
}

export async function register(page: Page, account: Account): Promise<void> {
  await page.goto(`${APP}/register`);
  await page.getByLabel("Your name").fill(account.name);
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("checkbox", { name: /terms of service/i }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /check your inbox/i })).toBeVisible();

  const verify = await linkFromMail(account.email, /confirm|verify/i, "/verify-email");
  await page.goto(verify);
  await expect(page.getByText(/confirmed|verified/i).first()).toBeVisible();
}

export async function signIn(page: Page, account: Pick<Account, "email" | "password">): Promise<void> {
  await page.goto(`${APP}/login`);
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
}

/** Creates a workspace from /workspaces and skips onboarding. Returns its slug. */
export async function createWorkspace(page: Page, businessName: string): Promise<string> {
  await page.goto(`${APP}/workspaces`);
  await page.getByLabel("Business name").fill(businessName);
  const address = page.getByLabel("Website address");
  await expect(address).not.toHaveValue("");
  const slug = await address.inputValue();
  await page.getByRole("button", { name: /create (workspace|my workspace)/i }).click();
  await page.waitForURL(/\/onboarding/);
  return slug;
}

/** Creates and publishes a private tour from the workspace. Returns its title. */
export async function publishPrivateTour(page: Page, title: string, price = "85"): Promise<void> {
  await page.goto(`${APP}/workspace/tours/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Summary").fill("A slow evening walk through the old city, ending with tea on a rooftop.");
  await page.getByText("Private tour", { exact: true }).click();
  await page.getByLabel("Duration shown to guests").fill("3 hours");
  await page.getByLabel(/^Adult price/).fill(price);
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(/\/workspace\/tours\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Publish tour" }).click();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
}

/** Finishes onboarding with defaults. */
export async function finishOnboarding(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("button", { name: /skip for now|continue/i }).first().click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByRole("button", { name: "Finish and open workspace" }).click();
  await page.waitForURL(`${APP}/workspace`);
}

/** Fails if the page can be scrolled sideways: the layout overflows the screen. */
export async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${where} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
}
