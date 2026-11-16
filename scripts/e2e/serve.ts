import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Starts the app for the end-to-end suite with the environment written by
 * `prepare.ts`, after seeding plans and the platform owner. Runs the dev
 * server on purpose: the mail-capture hook the tests rely on is disabled in
 * production builds.
 */
const env = { ...process.env, ...(JSON.parse(readFileSync(path.resolve(".local/e2e/env.json"), "utf8")) as Record<string, string>) };
const port = new URL(env.APP_URL!).port;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`))));
  });
}

async function main() {
  await run("pnpm", [
    "exec", "tsx", "scripts/db/seed.ts",
    "--owner-email", "owner@wayfold.test", "--owner-name", "Platform Owner", "--owner-password", "e2e-platform-owner-1",
  ]);
  const server = spawn("pnpm", ["exec", "next", "dev", "-p", port], { env, stdio: "inherit" });
  const stop = () => server.kill("SIGTERM");
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  server.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
