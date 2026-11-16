import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/helpers/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    setupFiles: ["tests/helpers/setup-env.ts"],
    // Each worker holds its own connection pools; keep well inside the core
    // count and the cluster's connection limit.
    maxWorkers: 4,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["**/*.test.ts", "src/server/db/schema/**"],
      reporter: ["text", "text-summary"],
      thresholds: { statements: 90, lines: 90 },
    },
  },
});
