import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

export interface RotationSummary {
  tenants: number;
  tenantIntegrationsRotated: number;
  tenantsFailed: number;
  platformIntegrationsRotated: number;
}

/**
 * Re-encrypts every stored integration credential under the active master
 * key: tenant by tenant inside each tenant's own transaction, then the
 * platform's own connections. See docs/operations/key-rotation.md.
 */
export async function rotateCredentialKeys(): Promise<RotationSummary> {
  // Loaded lazily so the `server-only` marker is neutralised first (see main).
  const { rotateAllCredentialKeys } = await import("../src/server/platform/key-rotation");
  return rotateAllCredentialKeys();
}

type ResolveContext = { conditions: string[] };
type ResolveHook = (specifier: string, context: ResolveContext, next: (specifier: string, context: ResolveContext) => unknown) => unknown;

/**
 * `server-only` throws when loaded outside a React Server build. This is
 * trusted operator tooling that reuses the server modules, so the marker is
 * resolved the way a server build resolves it: with the `react-server`
 * condition, which maps it to an empty module.
 */
function allowServerModules(): void {
  // `registerHooks` arrived in Node 22.15; the project's Node typings predate it.
  const { registerHooks } = nodeModule as unknown as { registerHooks?: (hooks: { resolve: ResolveHook }) => void };
  if (typeof registerHooks === "function") {
    registerHooks({
      resolve(specifier, context, next) {
        if (specifier !== "server-only") return next(specifier, context);
        return next(specifier, { ...context, conditions: [...context.conditions, "react-server"] });
      },
    });
    return;
  }
  // Older Node: put an empty module where the marker would be loaded from.
  const require = nodeModule.createRequire(import.meta.url);
  const id = require.resolve("server-only");
  require.cache[id] = Object.assign(new nodeModule.Module(id), { filename: id, loaded: true, exports: {} });
}

async function main(): Promise<void> {
  // Real environment variables win; the files only fill in what is missing.
  config({ path: [".env.local", ".env"], quiet: true });
  allowServerModules();

  let summary: RotationSummary;
  try {
    summary = await rotateCredentialKeys();
  } finally {
    const { closeDatabases } = await import("../src/server/db/client");
    await closeDatabases();
  }

  // Counts only. Nothing that identifies a credential is ever printed.
  console.log(`Workspaces checked: ${summary.tenants}`);
  console.log(`Tenant integrations re-encrypted: ${summary.tenantIntegrationsRotated}`);
  console.log(`Platform integrations re-encrypted: ${summary.platformIntegrationsRotated}`);
  if (summary.tenantsFailed > 0) {
    console.error(
      `Workspaces that could not be re-encrypted: ${summary.tenantsFailed}. ` +
        "Their credentials were left untouched; check that every key version still in use is listed in CREDENTIAL_ENCRYPTION_KEYS.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    // The message only: a driver error object can carry bound parameters.
    console.error(`Key rotation failed: ${error instanceof Error ? error.message.slice(0, 300) : "unknown error"}`);
    process.exit(1);
  });
}
