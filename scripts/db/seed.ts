import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config } from "dotenv";

export interface SeedOptions {
  ownerEmail?: string;
  ownerPassword?: string;
  ownerName?: string;
}

export interface SeedReport {
  plansCreated: string[];
  defaultPlan: string;
  owner: { userCreated: boolean; promoted: boolean } | null;
}

export function parseSeedArgs(argv: string[], environment: Record<string, string | undefined> = process.env): SeedOptions {
  const { values } = parseArgs({
    // pnpm forwards a bare `--` separator; it carries no meaning here.
    args: argv.filter((arg) => arg !== "--"),
    options: {
      "owner-email": { type: "string" },
      "owner-password": { type: "string" },
      "owner-name": { type: "string" },
    },
  });
  return {
    ownerEmail: values["owner-email"],
    // The variable keeps the password out of shell history and the process list.
    ownerPassword: values["owner-password"] ?? environment.WAYFOLD_OWNER_PASSWORD,
    ownerName: values["owner-name"],
  };
}

/**
 * Seeds what a new installation cannot work without: the plan catalogue and,
 * when an e-mail is given, the first platform owner. Idempotent: plans that
 * exist are left alone, and an existing account keeps its password.
 */
export async function seed(options: SeedOptions = {}): Promise<SeedReport> {
  // Loaded lazily so the `server-only` marker is neutralised first (see main).
  const { ensureDefaultPlans } = await import("../../src/server/platform/plans");
  const { ensurePlatformOwner } = await import("../../src/server/platform/admins");

  const plans = await ensureDefaultPlans();
  let owner: SeedReport["owner"] = null;
  if (options.ownerEmail) {
    const ensured = await ensurePlatformOwner({
      email: options.ownerEmail,
      password: options.ownerPassword,
      ...(options.ownerName ? { name: options.ownerName } : {}),
    });
    owner = { userCreated: ensured.userCreated, promoted: ensured.promoted };
  }
  return { plansCreated: plans.created, defaultPlan: plans.defaultCode, owner };
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

function describeFailure(error: unknown): string {
  const e = error as { message?: string; fieldErrors?: Record<string, string[]>; cause?: { message?: string } };
  const fields = Object.entries(e?.fieldErrors ?? {}).map(([field, messages]) => `${field}: ${messages.join(" ")}`);
  return [e?.cause?.message, e?.message, ...fields].filter(Boolean).join(" | ").slice(0, 500) || "unknown error";
}

async function main(): Promise<void> {
  // Real environment variables win; the files only fill in what is missing.
  config({ path: [".env.local", ".env"], quiet: true });
  allowServerModules();
  const options = parseSeedArgs(process.argv.slice(2));

  try {
    const report = await seed(options);
    console.log(report.plansCreated.length > 0 ? `Plans created: ${report.plansCreated.join(", ")}.` : "Plans already present; none created.");
    console.log(`Default plan for new workspaces: ${report.defaultPlan}.`);
    if (!report.owner) {
      console.log("No platform owner requested (pass --owner-email to create one).");
    } else if (report.owner.userCreated) {
      console.log(`Platform owner account created for ${options.ownerEmail}.`);
    } else if (report.owner.promoted) {
      console.log(`Existing account ${options.ownerEmail} is now a platform owner. Its password was not changed.`);
    } else {
      console.log(`${options.ownerEmail} is already a platform owner. Nothing changed.`);
    }
  } finally {
    const { closeDatabases } = await import("../../src/server/db/client");
    await closeDatabases();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`Seeding failed: ${describeFailure(error)}`);
    process.exit(1);
  });
}
