import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const crossTenant = {
  group: ["**/server/platform/db", "**/platform/db"],
  message: "withPlatform crosses tenant boundaries. Only src/server/platform may import it.",
};
const rawDatabase = {
  group: ["**/server/db/client", "**/db/client"],
  message: "Query through withTenant/withUser in server/db/context, not the raw connection.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Tenant isolation, enforced at lint time: only the platform module may
    // open a cross-tenant transaction, and only the db module may touch pools.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/platform/**", "src/server/db/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [crossTenant, rawDatabase] }] },
  },
  {
    files: ["src/server/platform/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [rawDatabase] }] },
  },
  {
    files: ["src/server/platform/db.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([".next/**", ".next-e2e/**", "out/**", "build/**", "next-env.d.ts", "design-reference/**", "coverage/**", ".local/**"]),
]);

export default eslintConfig;
