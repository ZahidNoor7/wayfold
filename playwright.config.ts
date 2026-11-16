import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3310";

/**
 * End-to-end tests drive the real app against a throw-away database, across
 * its real hosts: the dashboard at app.localhost and tenant storefronts at
 * {slug}.localhost (browsers resolve *.localhost to the loopback address).
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: ".local/e2e/results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://app.localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /.*\.phone\.spec\.ts/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /.*\.phone\.spec\.ts/ },
  ],
  webServer: {
    command: "pnpm exec tsx scripts/e2e/prepare.ts && pnpm exec tsx scripts/e2e/serve.ts",
    url: `http://127.0.0.1:${PORT}/api/health`,
    // E2E_REUSE=1 runs against an e2e server you started yourself (scripts/e2e).
    reuseExistingServer: process.env.E2E_REUSE === "1",
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
